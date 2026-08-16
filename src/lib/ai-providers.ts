import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export function safeParseJSON<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Clean control characters, unescaped newlines & trailing commas
      const sanitize = cleaned
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (c) =>
          c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : ""
        );
      return JSON.parse(sanitize) as T;
    }
  } catch {
    return fallback;
  }
}

export interface LoggerFn {
  (
    type:
      | "info"
      | "action"
      | "phase"
      | "success"
      | "error"
      | "monitor"
      | "ci_status"
      | "tool_call"
      | "tool_result",
    text: string,
    payload?: unknown
  ): void;
}

export async function generateAIText(
  prompt: string,
  isJson = false,
  log?: LoggerFn
): Promise<string> {
  const nvidiaKey = process.env.NVIDIA_API_KEY || process.env.NEMOTRON_API_KEY;
  const hasNvidiaKey = Boolean(
    nvidiaKey &&
      !nvidiaKey.includes("your-free-key") &&
      !nvidiaKey.includes("your_nvidia")
  );
  const nvidiaModel = process.env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct";
  const geminiKey = process.env.GEMINI_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  // 1. NVIDIA NIM OpenAI-compatible API (Primary & Exclusively Recommended)
  if (hasNvidiaKey && nvidiaKey) {
    const nvidiaModels = [
      nvidiaModel,
      "meta/llama-3.3-70b-instruct",
      "meta/llama-3.1-70b-instruct",
      "meta/llama-3.1-8b-instruct",
      "mistralai/mistral-large-2-instruct",
      "qwen/qwen2.5-72b-instruct",
      "deepseek-ai/deepseek-r1",
    ];
    const uniqueNvidiaModels = Array.from(new Set(nvidiaModels)).filter(
      (m) => m && !m.includes("muse-glimmer") && !m.includes("nemotron-70b-instruct") && !m.includes("deepseek-r1")
    );

    for (const modelName of uniqueNvidiaModels) {
      try {
        const nvidiaAi = new OpenAI({
          baseURL: "https://integrate.api.nvidia.com/v1",
          apiKey: nvidiaKey.trim(),
          timeout: 25000,
        });
        const res = await nvidiaAi.chat.completions.create({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          ...(isJson ? { response_format: { type: "json_object" } } : {}),
        });
        const text = res.choices[0]?.message?.content;
        if (text) {
          log?.("info", `Generated inference using NVIDIA NIM (${modelName}).`);
          return text;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.("info", `NVIDIA NIM (${modelName}) failed (${errMsg.slice(0, 80)}...). Trying next...`);
      }
    }
  }

  // 2. Google Gemini Native SDK (Secondary Fallback)
  if (geminiKey && !geminiKey.includes("your_gemini")) {
    const geminiModels = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ];
    const genAI = new GoogleGenerativeAI(geminiKey.trim());
    for (const modelName of geminiModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          ...(isJson ? { generationConfig: { responseMimeType: "application/json" } } : {}),
        });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (text) {
          log?.("info", `Generated inference using Google Gemini (${modelName}).`);
          return text;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.("info", `Gemini model ${modelName} fallback (${errMsg.slice(0, 80)}...). Trying next...`);
      }
    }
  }

  // 3. GitHub Models Inference API
  if (githubToken) {
    const ghModels = ["gpt-4o-mini", "gpt-4o", "Meta-Llama-3.1-70B-Instruct"];
    for (const ghModel of ghModels) {
      try {
        const ghAi = new OpenAI({
          baseURL: "https://models.inference.ai.azure.com",
          apiKey: githubToken.trim(),
          timeout: 25000,
        });
        const res = await ghAi.chat.completions.create({
          model: ghModel,
          ...(isJson ? { response_format: { type: "json_object" } } : {}),
          messages: [{ role: "user", content: prompt }],
        });
        const text = res.choices[0]?.message?.content;
        if (text) return text;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.("info", `GitHub Models (${ghModel}) failed (${errMsg.slice(0, 80)}...).`);
      }
    }
  }

  throw new Error("All AI inference providers failed. Check API keys and network in .env.local.");
}
