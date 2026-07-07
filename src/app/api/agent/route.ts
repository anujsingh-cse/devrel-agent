import { NextRequest } from "next/server";
import { Octokit } from "@octokit/rest";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (type: string, text: string) => {
        const data = JSON.stringify({
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type,
          text
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        if (!url || !url.includes("github.com")) {
          throw new Error("Invalid GitHub URL.");
        }

        const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/);
        if (!match) {
          throw new Error("Could not parse owner, repo, and issue number from URL.");
        }

        const [, owner, repo, issueNumber] = match;

        sendLog("info", `Parsed URL: Owner=${owner}, Repo=${repo}, Issue=${issueNumber}`);
        sendLog("action", "Initializing GitHub Octokit & Gemini client...");

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

        if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is missing in environment variables.");
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing in environment variables.");

        sendLog("info", "Fetching issue details from GitHub...");
        const { data: issue } = await octokit.rest.issues.get({
          owner,
          repo,
          issue_number: parseInt(issueNumber)
        });

        sendLog("success", `Issue fetched: "${issue.title}"`);
        sendLog("action", "Analyzing semantic intent of issue body via Gemini...");

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", generationConfig: { responseMimeType: "application/json" } });

        const prompt = `You are an AI maintainer. The user reported an issue:\nTitle: ${issue.title}\nBody: ${issue.body}\n\nDetermine the intent (e.g. TYPO_CORRECTION) and which file they are likely referring to. Respond in JSON format strictly matching this schema: { "intent": "string", "confidence": number, "file_path": "string", "instructions": "string" }. CRITICAL: Escape any quotation marks inside strings.`;
        
        const completion = await model.generateContent(prompt);
        let rawText = completion.response.text() || "{}";
        // Gemini sometimes wraps JSON in markdown blocks even with application/json mime type
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const analysis = JSON.parse(rawText);
        
        sendLog("success", `Intent identified: ${analysis.intent} (confidence: ${Math.round(analysis.confidence * 100)}%)`);

        if (!analysis.file_path) {
          throw new Error("Could not determine a specific file to fix from the issue.");
        }

        sendLog("action", `Fetching file content for ${analysis.file_path}...`);
        
        const { data: fileData } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: analysis.file_path,
        });

        if (!("content" in fileData) || Array.isArray(fileData)) {
          throw new Error("Target file is a directory or too large.");
        }

        const fileContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
        sendLog("success", `File ${analysis.file_path} loaded successfully.`);
        sendLog("action", "Generating AST transformations and applying fixes...");

        const fixModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const fixPrompt = `You are fixing code. Based on these instructions: "${analysis.instructions}", modify the following file content. Output ONLY the raw modified file content, with no markdown code blocks, no explanations.\n\nFile:\n${fileContent}`;
        
        const fixCompletion = await fixModel.generateContent(fixPrompt);
        let newContent = fixCompletion.response.text() || "";
        
        if (newContent.startsWith("\`\`\`")) {
            const lines = newContent.split('\n');
            if (lines.length > 1) {
                newContent = lines.slice(1, -1).join('\n');
            }
        }

        sendLog("success", "Changes generated successfully.");
        sendLog("action", "Creating new branch and committing changes...");

        const branchName = `fix/issue-${issueNumber}-${Date.now()}`;
        
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
        const defaultBranch = repoData.default_branch;
        
        const { data: refData } = await octokit.rest.git.getRef({
          owner, repo, ref: `heads/${defaultBranch}`
        });
        const baseSha = refData.object.sha;

        await octokit.rest.git.createRef({
          owner, repo, ref: `refs/heads/${branchName}`, sha: baseSha
        });

        await octokit.rest.repos.createOrUpdateFileContents({
          owner, repo,
          path: analysis.file_path,
          message: `Fix issue #${issueNumber}: ${analysis.intent}`,
          content: Buffer.from(newContent).toString('base64'),
          sha: fileData.sha,
          branch: branchName
        });

        sendLog("success", "Changes committed to origin.");
        sendLog("action", "Creating Pull Request...");

        const { data: pr } = await octokit.rest.pulls.create({
          owner, repo,
          title: `Fix: ${issue.title} (Auto-Generated)`,
          body: `This PR automatically resolves #${issueNumber} based on the issue description. \n\n**Intent:** ${analysis.intent}\n**Instructions:** ${analysis.instructions}\n\n*Generated by DevRel Agent using Gemini 1.5 Pro.*`,
          head: branchName,
          base: defaultBranch
        });

        sendLog("success", `Pull Request #${pr.number} successfully opened!`);
        sendLog("info", `PR URL: ${pr.html_url}`);

        controller.close();
      } catch (error: any) {
        sendLog("error", `Error: ${error.message}`);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
