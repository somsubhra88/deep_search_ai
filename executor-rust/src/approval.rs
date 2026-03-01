//! Pending approvals and "remember this" scoped rules.

use crate::models::{ApprovalDecision, ToolRequest};
use crate::policy::{risk_level, tool_name};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;
use uuid::Uuid;

pub struct PendingApproval {
    pub id: String,
    pub run_id: String,
    pub tool: ToolRequest,
    pub risk_level: u8,
    pub tx: oneshot::Sender<ApprovalResult>,
}

pub enum ApprovalResult {
    Approved,
    Denied,
}

pub struct ApprovalStore {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

impl ApprovalStore {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(
        &self,
        run_id: &str,
        tool: ToolRequest,
    ) -> (String, tokio::sync::oneshot::Receiver<ApprovalResult>) {
        let id = Uuid::new_v4().to_string();
        let risk = risk_level(&tool) as u8;
        let (tx, rx) = oneshot::channel();
        let pending = PendingApproval {
            id: id.clone(),
            run_id: run_id.to_string(),
            tool,
            risk_level: risk,
            tx,
        };
        self.pending.lock().unwrap().insert(id.clone(), pending);
        (id, rx)
    }

    pub fn respond(
        &self,
        approval_id: &str,
        decision: ApprovalDecision,
    ) -> Result<Option<RespondedApproval>, String> {
        let mut guard = self.pending.lock().unwrap();
        if let Some(pending) = guard.remove(approval_id) {
            let result = match decision {
                ApprovalDecision::Approve => ApprovalResult::Approved,
                ApprovalDecision::Deny => ApprovalResult::Denied,
            };
            let _ = pending.tx.send(result);
            Ok(Some(RespondedApproval {
                tool: pending.tool,
                run_id: pending.run_id,
                approved: matches!(decision, ApprovalDecision::Approve),
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get(&self, approval_id: &str) -> Option<PendingApprovalInfo> {
        let guard = self.pending.lock().unwrap();
        guard.get(approval_id).map(|p| PendingApprovalInfo {
            id: p.id.clone(),
            run_id: p.run_id.clone(),
            tool_name: tool_name(&p.tool).to_string(),
            tool: p.tool.clone(),
            risk_level: p.risk_level,
        })
    }

    pub fn list(&self) -> Vec<PendingApprovalInfo> {
        let guard = self.pending.lock().unwrap();
        guard
            .values()
            .map(|p| PendingApprovalInfo {
                id: p.id.clone(),
                run_id: p.run_id.clone(),
                tool_name: tool_name(&p.tool).to_string(),
                tool: p.tool.clone(),
                risk_level: p.risk_level,
            })
            .collect()
    }
}

pub struct RespondedApproval {
    pub tool: ToolRequest,
    pub run_id: String,
    pub approved: bool,
}

#[derive(Clone)]
pub struct PendingApprovalInfo {
    pub id: String,
    pub run_id: String,
    pub tool_name: String,
    pub tool: ToolRequest,
    pub risk_level: u8,
}
