//! Request/response models for the executor API.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "snake_case")]
pub enum ToolRequest {
    FsList { path: String },
    FsRead { path: String },
    FsStat { path: String },
    FsWrite { path: String, content: String },
    FsAppend { path: String, content: String },
    FsCopy { src: String, dst: String },
    FsMove { src: String, dst: String },
    FsRename { src: String, dst: String },
    FsDelete { path: String },
    NetDownload { url: String, dst_path: String },
    ArchiveExtract { archive_path: String, dst_dir: String },
    ShellRun { cmd: String, cwd: Option<String> },
    NotesCreate { title: String, content: String, folder: Option<String> },
    NotesUpdate { title: String, content: String, folder: Option<String> },
    NotesSearch { query: String, folder: Option<String> },
    ClipboardRead,
    ClipboardWrite { content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteRequest {
    pub run_id: Option<String>,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub context: Option<SearchContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolRequest>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchContext {
    pub query: Option<String>,
    pub results: Option<Vec<SearchResultItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub title: Option<String>,
    pub snippet: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRespondRequest {
    pub approval_id: String,
    pub decision: ApprovalDecision,
    #[serde(default)]
    pub save_rule: Option<SaveRuleScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approve,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveRuleScope {
    pub tool_name: Option<String>,
    pub path_prefix: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub tool_name: String,
    pub path_prefix: Option<String>,
    pub domain: Option<String>,
    pub action_fingerprint: Option<String>,
    pub decision: RuleDecision,
    pub risk_level_max: u8,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub usage_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleDecision {
    Allow,
    Deny,
    RequireApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRuleRequest {
    pub tool_name: String,
    pub path_prefix: Option<String>,
    pub domain: Option<String>,
    pub action_fingerprint: Option<String>,
    pub decision: RuleDecision,
    pub risk_level_max: Option<u8>,
}
