import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini Client safely
let ai: GoogleGenAI | null = null;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 120000, // 2 minutes timeout to prevent HeadersTimeoutError
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    console.log("Gemini client successfully initialized.");
  } else {
    console.warn("GEMINI_API_KEY is not defined. AI evaluation features will be disabled.");
  }
} catch (error) {
  console.error("Failed to initialize Gemini client:", error);
}

// Helper to load all candidate files
async function loadAllCandidates() {
  const candidates: any[] = [];
  const dataDir = path.join(process.cwd(), "src", "data");
  
  for (let i = 1; i <= 5; i++) {
    const filePath = path.join(dataDir, `candidates_${i}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = await fs.promises.readFile(filePath, "utf-8");
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed)) {
          candidates.push(...parsed);
        }
      }
    } catch (err) {
      console.error(`Error reading candidate file ${filePath}:`, err);
    }
  }
  return candidates;
}

// 1. Get all candidates
app.get("/api/candidates", async (req, res) => {
  try {
    const list = await loadAllCandidates();
    res.json({ success: true, count: list.length, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Evaluate selected candidates using Gemini AI
app.post("/api/evaluate", async (req, res) => {
  if (!ai) {
    return res.status(503).json({
      success: false,
      error: "AI Evaluation service is currently unavailable. Please verify that your GEMINI_API_KEY is configured in Settings > Secrets."
    });
  }

  const { candidateIds, recruiterQuery, customWeights } = req.body;

  if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
    return res.status(400).json({ success: false, error: "candidateIds array is required." });
  }

  if (!recruiterQuery || typeof recruiterQuery !== "string" || recruiterQuery.trim() === "") {
    return res.status(400).json({ success: false, error: "recruiterQuery string is required." });
  }

  try {
    // Load candidates from files
    const allCandidates = await loadAllCandidates();
    const targets = allCandidates.filter(c => candidateIds.includes(c.candidate_id));

    if (targets.length === 0) {
      return res.status(404).json({ success: false, error: "No matching candidates found for the provided IDs." });
    }

    // Since we want high-precision evaluations, we can call Gemini.
    // To stay safe and precise, we ask Gemini to evaluate the targets against the query and weights.
    const prompt = `You are an elite, highly precise technical recruiter and AI talent screener.
Evaluate the following candidates against the recruiter's search criteria and relative weights.

--- RECRUITER SEARCH CRITERIA ---
"${recruiterQuery}"

--- CRITERIA IMPORTANCE WEIGHTS (Scale 0 to 10) ---
- Technical Skills alignment: ${customWeights?.skillsWeight ?? 5}/10
- Relevant Years of Experience: ${customWeights?.experienceWeight ?? 5}/10
- Expected Salary alignment (INR LPA/other): ${customWeights?.salaryWeight ?? 5}/10
- Notice Period constraint (lower is better): ${customWeights?.noticePeriodWeight ?? 5}/10
- University Tier & Academic background: ${customWeights?.universityTierWeight ?? 5}/10
- GitHub Activity & Open Source engagement: ${customWeights?.githubActivityWeight ?? 5}/10

--- CANDIDATES DATA ---
${JSON.stringify(targets, null, 2)}

--- EVALUATION INSTRUCTIONS ---
For each candidate:
1. Compute a high-precision 'suitability_score' from 0 to 100 based strictly on how their skills, years of experience, current industry/history, education tier, and redrob_signals (like notice period, expected salary, github activity) align with the recruiter's search criteria and custom weights.
2. Provide a clear, objective 2-3 sentence 'analysis_summary' detailing exactly why they are or aren't a great fit.
3. Call out concrete 'pros' (e.g. key relevant skills, strong company pedigree, low notice period, high offer acceptance/interview completion rate).
4. Call out concrete 'cons' or 'concerns' (e.g. notice period too long, salary expected is high or missing, lack of key framework, potential job-hopping, low search appearance).
5. Suggest 2-3 highly specific technical/behavioral 'interview_questions' tailored to their exact background and the role.
6. Provide an honest 'verdict' from: "Highly Recommended", "Strong Match", "Potential Fit", "Not Aligned".

Evaluate all of them and return the results as a JSON array matching the specified response schema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          description: "List of candidate evaluation reports",
          items: {
            type: Type.OBJECT,
            required: ["candidate_id", "suitability_score", "analysis_summary", "pros", "cons", "interview_questions", "verdict"],
            properties: {
              candidate_id: {
                type: Type.STRING,
                description: "Unique ID of the candidate evaluated."
              },
              suitability_score: {
                type: Type.INTEGER,
                description: "Score from 0 to 100 based on alignment with recruiter query and weights."
              },
              analysis_summary: {
                type: Type.STRING,
                description: "A highly specific 2-3 sentence summary explaining this candidate's alignment."
              },
              pros: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Strengths and positive indicators."
              },
              cons: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Weaknesses, gaps, or potential recruiter flags."
              },
              interview_questions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Tailored interview questions for this specific candidate."
              },
              verdict: {
                type: Type.STRING,
                description: "The matching verdict: 'Highly Recommended', 'Strong Match', 'Potential Fit', or 'Not Aligned'."
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response content from Gemini.");
    }

    const parsedResults = JSON.parse(text.trim());
    res.json({ success: true, data: parsedResults });
  } catch (error: any) {
    console.error("Evaluation error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure Vite middleware and static serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up server in DEVELOPMENT mode with Vite Middleware.");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Setting up server in PRODUCTION mode with static file serving.");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express custom server running on http://0.0.0.0:${PORT}`);
  });
  server.timeout = 120000; // 2 minutes server request timeout
}

setupServer().catch((err) => {
  console.error("Failed to start server:", err);
});
