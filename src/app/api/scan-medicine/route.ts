export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return Response.json({ error: "Missing API key" }, { status: 500 });
    }
    
    // Remove prefix if present
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|webp|heic);base64,/, "");
    // Default mime type mapping based on typical uploads, Gemini usually infers or doesn't strictly need precise mime if valid image format 
    // but extracting the mime from data URI is better.
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z]*);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

    const prompt = `Extract the following from this medicine image:
1. Medicine Name
2. Batch Number
3. Expiry Date

Return JSON format exactly like:
{
  "name": "",
  "batch": "",
  "expiry": ""
}
Ensure expiry is returned in YYYY-MM format if possible, otherwise string. Return ONLY valid JSON block.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: cleanBase64
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();
    
    if (response.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const text = data.candidates[0].content.parts[0].text;
      
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        
        // Attempt to clean up YYYY-MM
        let cleanExpiry = parsed.expiry || "";
        if (cleanExpiry.match(/^[0-9]{4}-[0-9]{2}$/)) {
            // Already standard format YYYY-MM
        } else if (cleanExpiry.match(/^[0-9]{2}\/[0-9]{4}$/)) { // MM/YYYY
            const parts = cleanExpiry.split('/');
            cleanExpiry = `${parts[1]}-${parts[0].padStart(2, '0')}`;
        } else if (cleanExpiry.match(/^[0-9]{2}\/[0-9]{2}$/)) { // MM/YY
            const parts = cleanExpiry.split('/');
            const yearStr = parseInt(parts[1]) > 50 ? `19${parts[1]}` : `20${parts[1]}`;
            cleanExpiry = `${yearStr}-${parts[0].padStart(2, '0')}`;
        }
        
        parsed.expiry = cleanExpiry.substring(0, 7); // Input type month expects YYYY-MM

        return Response.json(parsed);
      } catch (err) {
         console.warn("JSON Parse Error returned from model:", text);
         return Response.json({ error: "Failed to parse data" }, { status: 400 });
      }
    }
    
    return Response.json({ error: "Failed to extract data" }, { status: 400 });

  } catch (error) {
    console.error("Scan API Error:", error);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
