import { NextRequest } from "next/server";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { url } = body;

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

        if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is missing in environment variables.");

        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

        // Available AI Providers
        const geminiKey = process.env.GEMINI_API_KEY;
        const nvidiaKey = process.env.NVIDIA_API_KEY || process.env.NEMOTRON_API_KEY;
        const hasNvidiaKey = !!(nvidiaKey && !nvidiaKey.includes("your-free-key"));

        const nvidiaModel = process.env.NVIDIA_MODEL || "meta/muse-glimmer-30b";
        sendLog("action", hasNvidiaKey ? `Initializing NVIDIA NIM Client (${nvidiaModel})...` : "Initializing AI inference engine (Google Gemini 1.5 Flash)...");

        const safeGenerateText = async (prompt: string, isJson = false): Promise<string> => {
          // 1. Try NVIDIA NIM first if key present
          if (hasNvidiaKey) {
            try {
              const nvidiaAi = new OpenAI({ baseURL: "https://integrate.api.nvidia.com/v1", apiKey: nvidiaKey.trim() });
              const res = await nvidiaAi.chat.completions.create({
                model: nvidiaModel,
                messages: [{ role: "user", content: prompt }],
              });
              const text = res.choices[0]?.message?.content;
              if (text) return text;
            } catch (err: any) {
              sendLog("info", `NVIDIA NIM (${nvidiaModel}) failed (${err?.message || err}). Falling back to Google Gemini...`);
            }
          }

          // 2. Try Native Google Gemini SDK
          if (geminiKey) {
            try {
              const genAI = new GoogleGenerativeAI(geminiKey.trim());
              const model = genAI.getGenerativeModel({
                model: "gemini-1.5-flash",
                ...(isJson ? { generationConfig: { responseMimeType: "application/json" } } : {}),
              });
              const result = await model.generateContent(prompt);
              const text = result.response.text();
              if (text) return text;
            } catch (err: any) {
              sendLog("info", `Gemini SDK call failed (${err?.message || err}). Trying GitHub Models...`);
            }
          }

          // 3. Try GitHub Models
          try {
            const ghAi = new OpenAI({ baseURL: "https://models.inference.ai.azure.com", apiKey: process.env.GITHUB_TOKEN });
            const res = await ghAi.chat.completions.create({
              model: "gpt-4o-mini",
              ...(isJson ? { response_format: { type: "json_object" } } : {}),
              messages: [{ role: "user", content: prompt }],
            });
            const text = res.choices[0]?.message?.content;
            if (text) return text;
          } catch (err: any) {
            sendLog("info", `GitHub Models failed (${err?.message || err}).`);
          }

          throw new Error("All AI inference providers failed. Check API keys in .env.local.");
        };

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
        
        const treeEntries = treeData.tree as Array<{ type?: string; path?: string }>;
        let files = treeEntries
          .filter((t) => t.type === 'blob' && t.path)
          .map((t) => t.path as string)
          .filter((path) => !path.match(/\.(png|jpg|jpeg|gif|svg|ico|mp4|webp|lock|csv|jsonl|pdf|ttf|woff|woff2)$/i))
          .filter((path) => !path.includes("node_modules/") && !path.includes("vendor/") && !path.includes("dist/") && !path.includes("build/") && !path.includes(".next/"));
        
        // Context token truncation limit
        let filesString = files.join('\n');
        if (filesString.length > 25000) {
            filesString = filesString.substring(0, 25000) + "\n... (list truncated to fit limits)";
        }

        sendLog("success", `Filtered down to ${files.length} relevant files for context.`);

        sendLog("action", "Analyzing semantic intent of issue body...");

        const prompt = `You are an AI maintainer. The user reported an issue:\nTitle: ${issue.title}\nBody: ${issue.body}\n\nDetermine the intent (e.g. TYPO_CORRECTION) and which file they are likely referring to.\n\nHere is a list of all files in the repository:\n${filesString}\n\nYou MUST select a file_path that exactly matches one of the paths in the provided repository tree.\n\nRespond in JSON format strictly matching this schema: { "intent": "string", "confidence": number, "file_path": "string", "instructions": "string" }. CRITICAL: Escape any quotation marks inside strings.`;
        
        let rawText = await safeGenerateText(prompt, true);
        // Clean up markdown code blocks if present
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const analysis = JSON.parse(rawText);
        
        sendLog("success", `Intent identified: ${analysis.intent} (confidence: ${Math.round((analysis.confidence || 0.95) * 100)}%)`);

        if (!analysis.file_path) {
          throw new Error("Could not determine a specific file to fix from the issue.");
        }

        let filePath = analysis.file_path;
        // Clean up any accidental leading slash
        if (filePath.startsWith('/')) {
            filePath = filePath.substring(1);
        }

        if (!files.includes(filePath)) {
          throw new Error(`File ${filePath} specified by AI does not exist in repository.`);
        }

        sendLog("info", `Target file selected: ${filePath}`);
        sendLog("info", `Fetching content of ${filePath}...`);
        
        let fileData;
        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath,
          });
          fileData = response.data;
        } catch (e: any) {
          if (e.status === 404) {
            throw new Error(`File ${filePath} specified by AI does not exist in repository.`);
          }
          throw e;
        }

        if (Array.isArray(fileData) || !("content" in fileData)) {
          throw new Error("Target file is a directory or too large.");
        }

        const fileContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
        sendLog("success", `File ${filePath} loaded successfully.`);
        sendLog("action", "Generating AST transformations and applying fixes...");

        const fixPrompt = `You are fixing code. Based on these instructions: "${analysis.instructions}", modify the following file content. Output ONLY the raw modified file content, with no markdown code blocks, no explanations.\n\nFile:\n${fileContent}`;
        
        let newContent = await safeGenerateText(fixPrompt, false);
        
        newContent = newContent.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

        sendLog("success", "Changes generated successfully.");
        sendLog("action", "Creating new branch and committing changes...");

        const branchName = `fix/issue-${issueNumber}-${Date.now()}`;
        
        const { data: user } = await octokit.rest.users.getAuthenticated();
        const username = user.login;
        let targetOwner = owner;

        if (owner !== username) {
          sendLog("action", `Checking/forking repository to ${username}...`);
          try {
            await octokit.rest.repos.createFork({ owner, repo });
            targetOwner = username;
            sendLog("info", "Waiting 5 seconds for GitHub to sync the fork...");
            await new Promise((resolve) => setTimeout(resolve, 5000));
          } catch (forkErr: any) {
            // Check if fork already exists under user account
            try {
              await octokit.rest.repos.get({ owner: username, repo });
              targetOwner = username;
              sendLog("info", `Fork ${username}/${repo} already exists, proceeding on existing fork...`);
            } catch {
              // If fork doesn't exist and user token has write access to original repo, fall back to direct branch
              sendLog("info", `Fork creation failed (${forkErr?.message || "Token missing fork permissions"}). Attempting direct branch creation on ${owner}/${repo}...`);
              targetOwner = owner;
            }
          }
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
          path: filePath,
          message: `Fix issue #${issueNumber}: ${analysis.intent}`,
          content: Buffer.from(newContent).toString('base64'),
          sha: fileData.sha,
          branch: branchName
        });

        sendLog("success", "Changes committed to fork.");
        sendLog("action", "Creating Pull Request...");

        const { data: pr } = await octokit.rest.pulls.create({
          owner, repo,
          title: `Fix: ${issue.title}`,
          body: `Hey! I've put together a fix for #${issueNumber}. \n\nLet me know if this looks good to you or if you need any adjustments!`,
          head: owner !== username ? `${username}:${branchName}` : branchName,
          base: defaultBranch
        });

        sendLog("success", `Pull Request #${pr.number} successfully opened!`);
        sendLog("info", `PR URL: ${pr.html_url}`);

        controller.close();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        sendLog("error", `Error: ${message}`);
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
