/**
 * Server-side LLM helper. Picks the best available provider from env and
 * calls an OpenAI-compatible chat completions endpoint.
 */

type LLMProvider = {
  name: string;
  envKey: string;
  baseUrl: string;
  defaultModel: string;
  modelEnv?: string;
};

const PROVIDERS: LLMProvider[] = [
  {
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    modelEnv: "OPENAI_MODEL",
  },
  {
    name: "Qwen",
    envKey: "QWEN_API_KEY",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    modelEnv: "QWEN_MODEL",
  },
  {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    modelEnv: "DEEPSEEK_MODEL",
  },
  {
    name: "Anthropic-compatible",
    envKey: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    modelEnv: "ANTHROPIC_MODEL",
  },
];

export function getAvailableProvider(): { apiKey: string; baseUrl: string; model: string; name: string } | null {
  for (const p of PROVIDERS) {
    const key = process.env[p.envKey];
    if (key && key.trim()) {
      const model = (p.modelEnv && process.env[p.modelEnv]) || p.defaultModel;
      return { apiKey: key.trim(), baseUrl: p.baseUrl, model, name: p.name };
    }
  }
  return null;
}

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number }
): Promise<string> {
  const provider = getAvailableProvider();
  if (!provider) {
    throw new Error("No LLM API key configured. Set OPENAI_API_KEY, QWEN_API_KEY, or another provider key in .env");
  }

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: options?.maxTokens || 2048,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM API error (${provider.name}): ${res.status} — ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No response from LLM.";
}
