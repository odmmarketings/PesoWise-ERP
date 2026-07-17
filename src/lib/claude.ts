import Anthropic from "@anthropic-ai/sdk"

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function parseExpenseFromText(text: string) {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a Philippine personal finance assistant. Extract expense entries from this text and return JSON only.

Text: "${text}"

Return a JSON array of expenses:
[{"description": "item name", "amount": number, "category": "Food|Transport|Shopping|Bills|Health|Entertainment|Other", "notes": "optional"}]

Rules:
- amounts are in Philippine Pesos
- if multiple expenses mentioned, return multiple objects
- category must be one of the listed options
- return ONLY valid JSON, no explanation`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== "text") throw new Error("Unexpected response")

  return JSON.parse(content.text)
}

export async function parseBankScreenshot(base64Image: string, mediaType: string) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64Image },
          },
          {
            type: "text",
            text: `This is a Philippine bank app screenshot. Extract the bank name and current account balance.
Return JSON only: {"bank_name": "BDO|BPI|Metrobank|UnionBank|GCash|Maya|Landbank|SecurityBank|PNB|CIMB|Tonik|GoTyme|Seabank|Other", "balance": number, "account_type": "Savings|Checking|Wallet|Unknown"}
If you cannot determine the bank or balance, return: {"error": "Could not read screenshot"}
Return ONLY valid JSON.`,
          },
        ],
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== "text") throw new Error("Unexpected response")
  return JSON.parse(content.text)
}

export async function generateFinancialInsight(data: {
  totalExpenses: number
  topCategories: { name: string; amount: number }[]
  vsLastMonth: number
  income?: number
}) {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `You are a friendly Filipino financial advisor. Give a short (2-3 sentences) personalized insight in English based on this month's data:
- Total expenses: ₱${data.totalExpenses.toLocaleString()}
- vs last month: ${data.vsLastMonth > 0 ? "+" : ""}${data.vsLastMonth}%
- Top categories: ${data.topCategories.map(c => `${c.name} ₱${c.amount.toLocaleString()}`).join(", ")}
${data.income ? `- Income: ₱${data.income.toLocaleString()}` : ""}

Be encouraging but honest. Give one specific actionable tip.`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== "text") return ""
  return content.text
}
