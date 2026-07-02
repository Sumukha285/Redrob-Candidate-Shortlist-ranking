export interface CandidateSkill {
  name: string;
  proficiency: string;
  endorsements?: number;
  duration_months?: number;
}

export interface CareerHistoryItem {
  company: string;
  title: string;
  start_date: string;
  end_date: string | null;
  duration_months: number;
  is_current: boolean;
  industry?: string;
  company_size?: string;
  description?: string;
}

export interface EducationItem {
  institution: string;
  degree: string;
  field_of_study: string;
  start_year: number;
  end_year: number | null;
  grade?: string;
  tier?: string; // tier_1, tier_2, tier_3, tier_4
}

export interface CertificationItem {
  name: string;
  issuer: string;
  year: number;
}

export interface LanguageItem {
  language: string;
  proficiency: string; // native, professional, conversational, beginner
}

export interface ExpectedSalaryRange {
  min: number;
  max: number;
}

export interface RedrobSignals {
  profile_completeness_score: number;
  signup_date: string;
  last_active_date: string;
  open_to_work_flag: boolean;
  profile_views_received_30d: number;
  applications_submitted_30d: number;
  recruiter_response_rate: number;
  avg_response_time_hours: number;
  skill_assessment_scores?: Record<string, number>;
  connection_count: number;
  endorsements_received: number;
  notice_period_days: number;
  expected_salary_range_inr_lpa?: ExpectedSalaryRange;
  preferred_work_mode?: string; // remote, hybrid, onsite, flexible
  willing_to_relocate: boolean;
  github_activity_score: number; // -1 if not connected
  search_appearance_30d: number;
  saved_by_recruiters_30d: number;
  interview_completion_rate: number;
  offer_acceptance_rate: number;
  verified_email: boolean;
  verified_phone: boolean;
  linkedin_connected: boolean;
}

export interface CandidateProfile {
  anonymized_name: string;
  headline: string;
  summary: string;
  location: string;
  country: string;
  years_of_experience: number;
  current_title: string;
  current_company: string;
  current_company_size?: string;
  current_industry?: string;
}

export interface Candidate {
  candidate_id: string;
  profile: CandidateProfile;
  career_history: CareerHistoryItem[];
  education: EducationItem[];
  skills: CandidateSkill[];
  certifications: CertificationItem[];
  languages: LanguageItem[];
  redrob_signals: RedrobSignals;
}

export interface EvaluationReport {
  candidate_id: string;
  suitability_score: number;
  analysis_summary: string;
  pros: string[];
  cons: string[];
  interview_questions: string[];
  verdict: "Highly Recommended" | "Strong Match" | "Potential Fit" | "Not Aligned" | string;
}

export interface CustomWeights {
  skillsWeight: number;
  experienceWeight: number;
  salaryWeight: number;
  noticePeriodWeight: number;
  universityTierWeight: number;
  githubActivityWeight: number;
}

export interface FilterState {
  searchQuery: string;
  skillsQuery: string;
  minExperience: number;
  maxExperience: number;
  maxSalary: number;
  maxNoticePeriod: number;
  selectedLocation: string;
  selectedEducationTier: string;
  willingToRelocate: boolean;
  openToWorkOnly: boolean;
  githubRequired: boolean;
}
