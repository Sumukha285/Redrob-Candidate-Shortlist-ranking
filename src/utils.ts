import { Candidate, FilterState, CustomWeights, IntegrityAudit } from "./types";

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

  let score = Math.round(weightedSum / totalWeight);

  if (filters.hallucinationShield) {
    const audit = auditCandidateProfile(candidate);
    score = Math.max(0, score - audit.scorePenalty);
  }

  return { score, breakdown };
}

/**
 * Runs structural consistency and integrity audits on a candidate profile
 * to automatically detect resume inflation, suspicious activity, or potential bots.
 */
export function auditCandidateProfile(candidate: Candidate): IntegrityAudit {
  const checks: { name: string; status: "pass" | "fail" | "warning"; message: string }[] = [];
  const reasons: string[] = [];
  let scorePenalty = 0;

  // 1. Contact Verification Check
  const hasVerifiedEmail = candidate.redrob_signals?.verified_email ?? false;
  const hasVerifiedPhone = candidate.redrob_signals?.verified_phone ?? false;
  if (hasVerifiedEmail && hasVerifiedPhone) {
    checks.push({
      name: "Contact Information Verification",
      status: "pass",
      message: "Both email and phone contact channels are fully verified.",
    });
  } else if (hasVerifiedEmail || hasVerifiedPhone) {
    checks.push({
      name: "Contact Information Verification",
      status: "warning",
      message: "Partial contact verification (either email or phone is unverified).",
    });
    scorePenalty += 5;
  } else {
    checks.push({
      name: "Contact Information Verification",
      status: "fail",
      message: "Unverified profile: Both email and phone numbers are completely unverified.",
    });
    reasons.push("Unverified email and phone contact channels (Spam/Bot Risk).");
    scorePenalty += 15;
  }

  // 2. Identity Connection Presence
  const isLinkedinConnected = candidate.redrob_signals?.linkedin_connected ?? false;
  const connections = candidate.redrob_signals?.connection_count ?? 0;
  if (isLinkedinConnected) {
    checks.push({
      name: "Social/Professional Identity Linkage",
      status: "pass",
      message: `LinkedIn account is securely connected (${connections} connections).`,
    });
  } else if (connections >= 100) {
    checks.push({
      name: "Social/Professional Identity Linkage",
      status: "warning",
      message: `LinkedIn disconnected, but profile exhibits a healthy network of ${connections} connections.`,
    });
    scorePenalty += 3;
  } else {
    checks.push({
      name: "Social/Professional Identity Linkage",
      status: "fail",
      message: "No connected professional LinkedIn account and low network presence (<100 connections).",
    });
    reasons.push("Missing professional LinkedIn connection combined with a sparse network profile.");
    scorePenalty += 10;
  }

  // 3. Profile Completeness
  const completeness = candidate.redrob_signals?.profile_completeness_score ?? 0;
  if (completeness >= 70) {
    checks.push({
      name: "Profile Completeness Audit",
      status: "pass",
      message: `Profile has high content density and completeness score of ${completeness}%.`,
    });
  } else if (completeness >= 45) {
    checks.push({
      name: "Profile Completeness Audit",
      status: "warning",
      message: `Moderately complete profile (${completeness}%). Some resume sections are sparse.`,
    });
    scorePenalty += 5;
  } else {
    checks.push({
      name: "Profile Completeness Audit",
      status: "fail",
      message: `Extremely skeletal profile content with a completeness rating of only ${completeness}%.`,
    });
    reasons.push("Extremely low profile completeness score (< 45%), indicating low-quality resume data.");
    scorePenalty += 15;
  }

  // 4. Experience Timeline Consistency & Resume Inflation Verification
  const claimedYears = candidate.profile?.years_of_experience ?? 0;
  const historyMonths = (candidate.career_history || []).reduce(
    (sum, job) => sum + (job.duration_months || 0),
    0
  );
  const historyYears = historyMonths / 12;

  if (claimedYears > 1.0) {
    const ratio = historyYears / claimedYears;
    if (ratio >= 0.8) {
      checks.push({
        name: "Experience Timeline Consistency Check",
        status: "pass",
        message: `Claimed experience (${claimedYears} yrs) is fully supported by listed employment history (${historyYears.toFixed(1)} yrs).`,
      });
    } else if (ratio >= 0.5) {
      checks.push({
        name: "Experience Timeline Consistency Check",
        status: "warning",
        message: `Minor timeline gap: candidate claims ${claimedYears} yrs but employment items account for only ${historyYears.toFixed(1)} yrs.`,
      });
      scorePenalty += 8;
    } else {
      checks.push({
        name: "Experience Timeline Consistency Check",
        status: "fail",
        message: `Severe timeline discrepancy: candidate claims ${claimedYears} years of experience, but listed employment history accounts for only ${historyYears.toFixed(1)} years (a gap of ${(claimedYears - historyYears).toFixed(1)} years). Significant resume inflation risk.`,
      });
      reasons.push(`Extreme experience timeline gap (claimed ${claimedYears} yrs but employment list only covers ${historyYears.toFixed(1)} yrs).`);
      scorePenalty += 25;
    }
  } else {
    checks.push({
      name: "Experience Timeline Consistency Check",
      status: "pass",
      message: "Early career candidate profile timeline checks passed.",
    });
  }

  // 5. Overemployment & Concurrency Audit
  const currentJobs = (candidate.career_history || []).filter(job => job.is_current === true).length;
  if (currentJobs <= 1) {
    checks.push({
      name: "Concurrent Employment Concurrency Audit",
      status: "pass",
      message: "Employment concurrency is standard (no conflicting concurrent full-time current positions).",
    });
  } else {
    checks.push({
      name: "Concurrent Employment Concurrency Audit",
      status: "fail",
      message: `Detected multiple (${currentJobs}) concurrent 'current' full-time job roles. Potential double-dipping or failure to update status.`,
    });
    reasons.push(`Detected multiple active current jobs (${currentJobs}), signifying concurrency conflicts.`);
    scorePenalty += 10;
  }

  // 6. Skill Assessment Integrity Check
  const hasSkills = candidate.skills && candidate.skills.length > 0;
  const skillAssessments = candidate.redrob_signals?.skill_assessment_scores || {};
  const assessmentKeys = Object.keys(skillAssessments);
  
  if (!hasSkills) {
    checks.push({
      name: "Skill Assessment Integrity",
      status: "fail",
      message: "No technical or soft skills are catalogued on this profile.",
    });
    reasons.push("Zero technical or professional skills declared.");
    scorePenalty += 15;
  } else if (assessmentKeys.length > 0) {
    const scores = Object.values(skillAssessments);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    
    if (avgScore >= 40) {
      checks.push({
        name: "Skill Assessment Integrity",
        status: "pass",
        message: `Validated skill assessments average ${avgScore.toFixed(1)}%, supporting claimed proficiency levels.`,
      });
    } else {
      checks.push({
        name: "Skill Assessment Integrity",
        status: "warning",
        message: `Low verified skill assessment scores (average: ${avgScore.toFixed(1)}%), representing potential skill inflation.`,
      });
      scorePenalty += 8;
    }
  } else {
    checks.push({
      name: "Skill Assessment Integrity",
      status: "warning",
      message: "Technical skills declared but no independent skill assessments have been taken/passed.",
    });
    scorePenalty += 4;
  }

  // Calculate final numbers
  const passedChecksCount = checks.filter(c => c.status === "pass").length;
  const totalChecksCount = checks.length;
  const isSuspicious = checks.some(c => c.status === "fail") || scorePenalty >= 20;

  return {
    candidate_id: candidate.candidate_id,
    isSuspicious,
    scorePenalty,
    reasons,
    passedChecksCount,
    totalChecksCount,
    checks,
  };
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
