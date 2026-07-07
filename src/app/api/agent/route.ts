import { NextRequest } from "next/server";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

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
        sendLog("action", "Initializing GitHub Octokit & GitHub Models client...");

        if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is missing in environment variables.");

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        
        // We use the OpenAI SDK but point it to GitHub Models!
        // This is 100% free for GitHub users and uses your existing GITHUB_TOKEN!
        const ai = new OpenAI({
          baseURL: "https://models.inference.ai.azure.com",
          apiKey: process.env.GITHUB_TOKEN
        });

        sendLog("info", "Fetching issue details from GitHub...");
        const { data: issue } = await octokit.rest.issues.get({
          owner,
          repo,
          issue_number: parseInt(issueNumber)
        });

        sendLog("success", `Issue fetched: "${issue.title}"`);
        
        sendLog("info", "Fetching repository file tree...");
        const { data: upstreamRepoData } = await octokit.rest.repos.get({ owner, repo });
        const { data: treeData } = await octokit.rest.git.getTree({
          owner, repo, tree_sha: upstreamRepoData.default_branch, recursive: "true"
        });
        
        let files = treeData.tree
          .filter((t: any) => t.type === 'blob')
          .map((t: any) => t.path)
          .filter((path: string) => !path.match(/\.(png|jpg|jpeg|gif|svg|ico|mp4|webp|lock|csv|jsonl|pdf|ttf|woff|woff2)$/i))
          .filter((path: string) => !path.includes("node_modules/") && !path.includes("vendor/") && !path.includes("dist/") && !path.includes("build/") && !path.includes(".next/"));
        
        // GitHub Models free tier has an 8k token limit (~30k characters)
        let filesString = files.join('\n');
        if (filesString.length > 25000) {
            filesString = filesString.substring(0, 25000) + "\n... (list truncated to fit limits)";
        }

        sendLog("success", `Filtered down to ${files.length} relevant files for context.`);

        sendLog("action", "Analyzing semantic intent of issue body via GPT-4o-mini...");

        const prompt = `You are an AI maintainer. The user reported an issue:\nTitle: ${issue.title}\nBody: ${issue.body}\n\nDetermine the intent (e.g. TYPO_CORRECTION) and which file they are likely referring to.\n\nHere is a list of all files in the repository:\n${filesString}\n\nYou MUST select a file_path that exactly matches one of the paths in the provided repository tree.\n\nRespond in JSON format strictly matching this schema: { "intent": "string", "confidence": number, "file_path": "string", "instructions": "string" }. CRITICAL: Escape any quotation marks inside strings.`;
        
        const completion = await ai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are an AI maintainer. Respond only with valid JSON." },
            { role: "user", content: prompt }
          ]
        });
        
        let rawText = completion.choices[0].message.content || "{}";
        // Clean up markdown code blocks if present
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

        const fixPrompt = `You are fixing code. Based on these instructions: "${analysis.instructions}", modify the following file content. Output ONLY the raw modified file content, with no markdown code blocks, no explanations.\n\nFile:\n${fileContent}`;
        
        const fixCompletion = await ai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an expert developer fixing a bug. Return ONLY the raw modified file content, no markdown, no explanations." },
            { role: "user", content: fixPrompt }
          ]
        });
        
        let newContent = fixCompletion.choices[0].message.content || "";
        
        if (newContent.startsWith("\`\`\`")) {
            const lines = newContent.split('\n');
            if (lines.length > 1) {
                newContent = lines.slice(1, -1).join('\n');
            }
        }

        sendLog("success", "Changes generated successfully.");
        sendLog("action", "Creating new branch and committing changes...");

        const branchName = `fix/issue-${issueNumber}-${Date.now()}`;
        
        const { data: user } = await octokit.rest.users.getAuthenticated();
        const username = user.login;
        let targetOwner = owner;

        if (owner !== username) {
          sendLog("action", `Forking repository to ${username}...`);
          await octokit.rest.repos.createFork({ owner, repo });
          targetOwner = username;
          
          sendLog("info", "Waiting 5 seconds for GitHub to create the fork...");
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        const { data: repoData } = await octokit.rest.repos.get({ owner: targetOwner, repo });
        const defaultBranch = repoData.default_branch;
        
        const { data: refData } = await octokit.rest.git.getRef({
          owner: targetOwner, repo, ref: `heads/${defaultBranch}`
        });
        const baseSha = refData.object.sha;

        await octokit.rest.git.createRef({
          owner: targetOwner, repo, ref: `refs/heads/${branchName}`, sha: baseSha
        });

        await octokit.rest.repos.createOrUpdateFileContents({
          owner: targetOwner, repo,
          path: analysis.file_path,
          message: `Fix issue #${issueNumber}: ${analysis.intent}`,
          content: Buffer.from(newContent).toString('base64'),
          sha: fileData.sha,
          branch: branchName
        });

        sendLog("success", "Changes committed to fork.");
        sendLog("action", "Creating Pull Request...");

        const { data: pr } = await octokit.rest.pulls.create({
          owner, repo,
          title: `Fix: ${issue.title} (Auto-Generated)`,
          body: `This PR automatically resolves #${issueNumber} based on the issue description. \n\n**Intent:** ${analysis.intent}\n**Instructions:** ${analysis.instructions}`,
          head: owner !== username ? `${username}:${branchName}` : branchName,
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
