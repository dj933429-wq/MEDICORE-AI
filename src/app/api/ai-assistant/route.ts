import { medicalDatabase } from "@/lib/medicalData";

const RATE_LIMIT = 15;
const WINDOW = 60 * 1000; // 1 minute

const ipRequests: Record<string, number[]> = {};

function rateLimiter(ip: string) {
  const now = Date.now();

  if (!ipRequests[ip]) {
    ipRequests[ip] = [];
  }

  ipRequests[ip] = ipRequests[ip].filter(
    (time) => now - time < WINDOW
  );

  if (ipRequests[ip].length >= RATE_LIMIT) {
    return false;
  }

  ipRequests[ip].push(now);
  return true;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";

    if (!rateLimiter(ip)) {
      return new Response(
        JSON.stringify({
          error: "Too many requests. Please wait."
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    // Use the original message for the prompt, convert to lowercase for searching
    const originalMessage = body.message || "";
    const message = originalMessage.toLowerCase();

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY");
      return Response.json({
        reply: "Server configuration error: API key missing"
      });
    }

    // Step 3: Detect symptoms
    let matchedCondition = null;
    for (const condition of medicalDatabase) {
      if (condition.keywords.some(keyword => message.includes(keyword.toLowerCase()))) {
        matchedCondition = condition;
        break;
      }
    }

    // Preserve dynamic model selection
    const modelFetchParams = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey
    );
    const modelsData = await modelFetchParams.json();
    
    let targetModel = "gemini-pro"; 

    if (modelsData && modelsData.models) {
      const supported = modelsData.models
        .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: any) => m.name.replace('models/', ''));

      if (supported.includes("gemini-1.5-flash")) targetModel = "gemini-1.5-flash";
      else if (supported.includes("gemini-1.5-pro")) targetModel = "gemini-1.5-pro";
      else if (supported.includes("gemini-1.0-pro")) targetModel = "gemini-1.0-pro";
      else if (supported.includes("gemini-pro")) targetModel = "gemini-pro";
      else if (supported.length > 0) targetModel = supported[0];
    }

    const callGemini = async (prompt: string) => {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt }
                  ]
                }
              ]
            })
          }
        );

        const data = await response.json();

        if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          return data.candidates[0].content.parts[0].text;
        }
        return null;
      } catch (err) {
        console.error("Gemini call error:", err);
        return null;
      }
    };

    if (matchedCondition) {
      // Step 4: Structuring response
      let reply = `Suggested Medicine:\n${matchedCondition.medicine}\n\nDosage:\n${matchedCondition.dosage}\n\nAdvice:\n${matchedCondition.advice}\n\nNote:\nIf symptoms persist for more than 2 days, consult a doctor.`;

      const prompt = `Explain why ${matchedCondition.medicine} works for ${matchedCondition.keywords.join(" or ")} and when to avoid it. Keep it simple, brief and easy to understand for a rural user.`;
      
      const explanation = await callGemini(prompt);
      
      if (explanation) {
        reply += `\n\nAdditional Info:\n${explanation}`;
      }

      return Response.json({ reply });
    } else {
      // Step 5: Fallback to AI
      const prompt = `You are a basic healthcare assistant for rural users.
Provide simple, safe, and practical advice.
Do not suggest strong or prescription medicines.
Always recommend doctor consultation for serious symptoms.

User: ${originalMessage}`;
      
      const fallbackResponse = await callGemini(prompt);
      
      if (fallbackResponse) {
        return Response.json({ reply: fallbackResponse });
      } else {
        // Step 6: Error Handling
        return Response.json({ reply: "Service temporarily unavailable. Please try again." });
      }
    }

  } catch (error) {
    console.error("Route error block:", error);
    return Response.json({
      reply: "Service temporarily unavailable. Please try again."
    });
  }
}
