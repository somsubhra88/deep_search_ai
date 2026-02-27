export type Stance = "FOR" | "AGAINST";
export type DebatePhase = "debate" | "cross_exam_question" | "cross_exam_answer" | "system";

export type PersonaConfig = {
  gender: "male" | "female" | "neutral";
  profession: string;
  attitude: string;
  style: string;
};

export type AgentProfile = {
  agent_id: "A" | "B";
  stance: Stance;
  persona: PersonaConfig;
  randomized: boolean;
};

export type DebateConfig = {
  turn_count: number;
  cross_exam_enabled: boolean;
  cross_exam_questions_per_agent: number;
  max_tokens_per_message: number;
  max_sentences_per_message: number;
  no_repetition: boolean;
  retrieval_enabled: boolean;
  evidence_urls: string[];
};

export type EvidenceCard = {
  card_id: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  quote: string;
  claim: string;
  confidence: number;
  perspective: "FOR" | "AGAINST" | "neutral";
  source_type: string;
};

export type DebateMessage = {
  messageId: string;
  agentId: "A" | "B";
  phase: DebatePhase;
  text: string;
  isStreaming: boolean;
  replyToMessageId?: string;
  challengesMessageId?: string;
  answersQuestionId?: string;
  createdAt?: string;
};

export type DebateArtifacts = {
  summary: {
    key_points_for: Array<{ point: string; message_ids: string[] }>;
    key_points_against: Array<{ point: string; message_ids: string[] }>;
    strongest_evidence: Array<{ evidence: string; message_ids: string[] }>;
    unresolved_points: string[];
    neutral_takeaway: string;
  };
  judge: {
    winner: "FOR" | "AGAINST" | "DRAW";
    rubric: Record<string, number>;
    rationales: Array<{ point: string; message_ids: string[] }>;
    executive_recommendation: string;
    risks_and_compliance_notes: string;
  };
  argumentGraph: {
    claims: Array<{
      claimId: string;
      text: string;
      byAgent: "A" | "B";
      messageIds: string[];
      type: "assertion" | "evidence" | "assumption" | "counterclaim";
    }>;
    relations: Array<{
      from: string;
      to: string;
      rel: "supports" | "refutes" | "clarifies";
    }>;
  };
  coverageGaps: Array<{
    gapId: string;
    type: string;
    severity: "high" | "medium" | "low";
    relatedClaimIds: string[];
    relatedMessageIds: string[];
    description: string;
    suggestedFollowupPrompt: string;
  }>;
};

export type DebateStatus = "idle" | "configuring" | "running" | "completed" | "cancelled" | "error";

export const PROFESSIONS = [
  "Lawyer", "Scientist", "Journalist", "Engineer", "Philosopher",
  "Economist", "Doctor", "Teacher", "Political Analyst", "CEO",
  "Ethicist", "Data Scientist", "Psychologist", "Historian",
];

export const ATTITUDES = [
  "aggressive", "logical", "data-backed", "friendly", "skeptical",
  "diplomatic", "provocative", "analytical",
];

export const STYLES = [
  "concise", "verbose", "formal", "casual",
];

export const GENDERS: Array<"male" | "female" | "neutral"> = ["male", "female", "neutral"];
