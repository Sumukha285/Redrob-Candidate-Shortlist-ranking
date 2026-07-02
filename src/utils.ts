import { Candidate, FilterState, CustomWeights } from "./types";

/**
 * Calculates a highly deterministic structural match score from 0 to 100
 * based on candidate profile attributes against custom weights and filter state.
 */
export function calculateMatchScore(
  candidate: Candidate,
  filters: FilterState,
  weights: CustomWeights
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    skills: 0,
    experience: 0,
    salary: 0,
    noticePeriod: 0,
    education: 0,
    github: 0,
  };

  // 1. SKILLS MATCH (Max 100 points)
  // If the recruiter has queried specific skills, score based on exact/partial matches.
  // Otherwise, default to matching candidate skills against candidate profile quality.
  const targetSkills = filters.skillsQuery
    ? filters.skillsQuery
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  if (targetSkills.length > 0) {
    let matchedCount = 0;
    candidate.skills.forEach((cs) => {
      const cSkillName = cs.name.toLowerCase();
      if (targetSkills.some((ts) => cSkillName.includes(ts) || ts.includes(cSkillName))) {
        matchedCount += cs.proficiency === "expert" ? 1.2 : cs.proficiency === "advanced" ? 1.0 : 0.7;
      }
    });
    const matchRatio = Math.min(1, matchedCount / targetSkills.length);
    breakdown.skills = Math.round(matchRatio * 100);
  } else {
    // General skills quality score based on expert & advanced skill counts
    const expertCount = candidate.skills.filter((s) => s.proficiency === "expert").length;
    const advCount = candidate.skills.filter((s) => s.proficiency === "advanced").length;
    breakdown.skills = Math.min(100, (expertCount * 15 + advCount * 10 + candidate.skills.length * 2) + 40);
  }

  // 2. EXPERIENCE MATCH (Max 100 points)
  const candidateExp = candidate.profile.years_of_experience || 0;
  if (candidateExp >= filters.minExperience && candidateExp <= filters.maxExperience) {
    breakdown.experience = 100;
  } else if (candidateExp < filters.minExperience) {
    const diff = filters.minExperience - candidateExp;
    breakdown.experience = Math.max(0, Math.round(100 - diff * 20));
  } else {
    const diff = candidateExp - filters.maxExperience;
    breakdown.experience = Math.max(50, Math.round(100 - diff * 5)); // Overqualified is less penalized
  }

  // 3. EXPECTED SALARY MATCH (Max 100 points)
  const salaryRange = candidate.redrob_signals.expected_salary_range_inr_lpa;
  if (salaryRange) {
    const minS = salaryRange.min;
    const maxS = salaryRange.max;
    // We prefer candidates whose expected salary falls below the recruiter's maximum salary budget
    if (minS <= filters.maxSalary) {
      breakdown.salary = 100;
    } else {
      const overBudgetPercent = (minS - filters.maxSalary) / filters.maxSalary;
      breakdown.salary = Math.max(0, Math.round(100 - overBudgetPercent * 150));
    }
  } else {
    breakdown.salary = 70; // Default when missing
  }

  // 4. NOTICE PERIOD MATCH (Max 100 points)
  const noticeDays = candidate.redrob_signals.notice_period_days;
  if (noticeDays <= filters.maxNoticePeriod) {
    breakdown.noticePeriod = 100;
  } else {
    const excessDays = noticeDays - filters.maxNoticePeriod;
    breakdown.noticePeriod = Math.max(0, Math.round(100 - excessDays * 1.5));
  }

  // 5. EDUCATION TIER MATCH (Max 100 points)
  // Find highest education tier
  let highestTier = "tier_4";
  candidate.education.forEach((edu) => {
    const t = edu.tier || "tier_4";
    if (t === "tier_1") highestTier = "tier_1";
    else if (t === "tier_2" && highestTier !== "tier_1") highestTier = "tier_2";
    else if (t === "tier_3" && highestTier !== "tier_1" && highestTier !== "tier_2") highestTier = "tier_3";
  });

  if (highestTier === "tier_1") {
    breakdown.education = 100;
  } else if (highestTier === "tier_2") {
    breakdown.education = 85;
  } else if (highestTier === "tier_3") {
    breakdown.education = 70;
  } else {
    breakdown.education = 50;
  }

  // 6. GITHUB MATCH (Max 100 points)
  const hasGithub = candidate.redrob_signals.github_activity_score !== -1;
  const githubScore = candidate.redrob_signals.github_activity_score;
  if (hasGithub) {
    breakdown.github = Math.min(100, Math.round((githubScore || 0) * 2 + 50));
  } else {
    breakdown.github = filters.githubRequired ? 0 : 40;
  }

  // Calculate Weighted Sum
  const totalWeight =
    weights.skillsWeight +
    weights.experienceWeight +
    weights.salaryWeight +
    weights.noticePeriodWeight +
    weights.universityTierWeight +
    weights.githubActivityWeight;

  if (totalWeight === 0) {
    return { score: 70, breakdown };
  }

  const weightedSum =
    breakdown.skills * weights.skillsWeight +
    breakdown.experience * weights.experienceWeight +
    breakdown.salary * weights.salaryWeight +
    breakdown.noticePeriod * weights.noticePeriodWeight +
    breakdown.education * weights.universityTierWeight +
    breakdown.github * weights.githubActivityWeight;

  const score = Math.round(weightedSum / totalWeight);

  return { score, breakdown };
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  rowCount: number;
}

/**
 * Validates a CSV string's compliance against the exact rules of validate_submission.py
 */
export function validateCSVContent(content: string, fileName?: string): ValidationResult {
  const errors: string[] = [];
  
  if (fileName && !fileName.toLowerCase().endsWith(".csv")) {
    errors.push("Filename must use a .csv extension.");
  }

  // Parse lines, taking care of empty lines
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map(line => line.trim()).filter(line => line.length > 0);

  if (lines.length === 0) {
    return { isValid: false, errors: ["File is empty."], rowCount: 0 };
  }

  // Check header (Row 1)
  const REQUIRED_HEADER = ["candidate_id", "rank", "score", "reasoning"];
  const headerParts = lines[0].split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
  
  if (headerParts.length !== REQUIRED_HEADER.length || !headerParts.every((val, i) => val === REQUIRED_HEADER[i])) {
    errors.push(`Row 1 (header) must be exactly: ${REQUIRED_HEADER.join(",")}. Found: ${headerParts.join(",")}`);
    return { isValid: false, errors, rowCount: 0 };
  }

  // Parse data rows
  const dataLines = lines.slice(1);
  const dataRows: string[][] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const cells: string[] = [];
    let inQuotes = false;
    let currentCell = "";
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(currentCell.trim());
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
    cells.push(currentCell.trim());
    dataRows.push(cells);
  }

  const n = dataRows.length;
  if (n !== 100) {
    errors.push(`After the header, there must be exactly 100 data rows (rows 2-101). Found ${n} rows.`);
  }

  const seenIds = new Set<string>();
  const seenRanks = new Set<number>();
  const byRank: { rank: number; score: number; cid: string }[] = [];
  const CANDIDATE_ID_PATTERN = /^CAND_[0-9]{7}$/;

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    const rowNum = i + 2;

    if (cells.length < 3) {
      errors.push(`Row ${rowNum}: expected at least 3 columns (candidate_id, rank, score, [reasoning]), got ${cells.length}.`);
      continue;
    }

    const cid = cells[0].replace(/^["']|["']$/g, "").trim();
    const rankStr = cells[1].replace(/^["']|["']$/g, "").trim();
    const scoreStr = cells[2].replace(/^["']|["']$/g, "").trim();

    if (!cid) {
      errors.push(`Row ${rowNum}: candidate_id is required.`);
    } else if (!CANDIDATE_ID_PATTERN.test(cid)) {
      errors.push(`Row ${rowNum}: candidate_id must be CAND_XXXXXXX (7 digits). Found: "${cid}"`);
    } else if (seenIds.has(cid)) {
      errors.push(`Row ${rowNum}: duplicate candidate_id '${cid}'.`);
    } else {
      seenIds.add(cid);
    }

    const rank = parseInt(rankStr, 10);
    if (isNaN(rank) || rank.toString() !== rankStr || rank < 1 || rank > 100) {
      errors.push(`Row ${rowNum}: rank must be an integer between 1 and 100. Found: "${rankStr}"`);
    } else if (seenRanks.has(rank)) {
      errors.push(`Row ${rowNum}: duplicate rank ${rank}.`);
    } else {
      seenRanks.add(rank);
    }

    const score = parseFloat(scoreStr);
    if (isNaN(score)) {
      errors.push(`Row ${rowNum}: score must be a valid float. Found: "${scoreStr}"`);
    }

    if (!isNaN(rank) && !isNaN(score) && cid && CANDIDATE_ID_PATTERN.test(cid)) {
      byRank.push({ rank, score, cid });
    }
  }

  // Check missing ranks
  const missingRanks: number[] = [];
  for (let r = 1; r <= 100; r++) {
    if (!seenRanks.has(r)) {
      missingRanks.push(r);
    }
  }
  if (missingRanks.length > 0) {
    errors.push(`Each rank 1-100 must appear exactly once. Missing ranks: ${missingRanks.join(", ")}`);
  }

  // Sort by rank to check ordering and tie-breakers
  byRank.sort((a, b) => a.rank - b.rank);

  // Check score non-increasing ordering and tie-breaks
  for (let i = 0; i < byRank.length - 1; i++) {
    const r1 = byRank[i];
    const r2 = byRank[i + 1];
    
    if (r1.score < r2.score) {
      errors.push(`Score must be non-increasing by rank: rank ${r1.rank} (${r1.score.toFixed(4)}) < rank ${r2.rank} (${r2.score.toFixed(4)}).`);
    }
    
    if (r1.score === r2.score) {
      if (r1.cid > r2.cid) {
        errors.push(`Equal scores at ranks ${r1.rank} and ${r2.rank}: tie-break requires candidate_id ascending alphabetically ("${r1.cid}" should come before "${r2.cid}").`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    rowCount: n,
  };
}
