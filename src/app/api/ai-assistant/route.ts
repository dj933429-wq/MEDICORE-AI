export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = body.message;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY");
      return Response.json({
        reply: "Server configuration error: API key missing"
      });
    }

    // 1: Dynamically determine the best configured model for this specific key
    const modelFetchParams = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey
    );
    const modelsData = await modelFetchParams.json();
    console.log("AVAILABLE MODELS payload logs:", modelsData);

    let targetModel = "gemini-pro"; // ultimate fallback

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

    console.log("Dynamically Selected Best Model:", targetModel);

    // 2: Construct the generation blocks executing securely targeting the allowed endpoint natively
    const prompt = `
You are a safe medical assistant.
Do NOT provide diagnosis.
Only give general health advice.
Always recommend consulting a doctor.

User: ${message}
`;

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

    console.log("Status:", response.status);
    console.log("Response:", data);

    if (!response.ok) {
      console.error("Gemini API error intercept:", data);
      return Response.json({
        reply: "AI error: " + (data.error?.message || "Unknown error")
      });
    }

    let reply = "Sorry, I couldn't process that.";

    if (
      data &&
      data.candidates &&
      data.candidates.length > 0 &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts.length > 0
    ) {
      reply = data.candidates[0].content.parts[0].text;
    }

    return Response.json({ reply });

  } catch (error) {
    console.error("Gemini error block:", error);
    return Response.json({
      reply: "Server error. Please try again."
    });
  }
}
