# Phase C.1.1 — Dependency and Environment Cleanup Plan

Repository:
m-alasadi/chatbot

Context:
- Phase A architecture report is approved
- Phase B.1 stabilization blueprint is approved
- Phase B.2 multi-tenant blueprint is approved
- Current goal is safe implementation, starting with low-risk cleanup

IMPORTANT:
Do not modify source code in this step.
Do not edit package.json yet.
Do not remove packages yet.
This step is planning only.

---

## OBJECTIVE

Create a precise cleanup plan for:
1. unused dependencies
2. unused devDependencies
3. environment variables that are truly used
4. environment variables that can be removed from `.env.local.example`

The plan must be conservative and safe.

---

## REQUIRED OUTPUT FILE

Generate exactly one file:

DEPENDENCY_CLEANUP_PLAN.md

---

## REQUIRED SECTIONS

### 1. Confirmed Used Dependencies
List dependencies that are definitely used by actual imports.

### 2. Confirmed Unused Dependencies
List dependencies that have no imports in the repository and are safe candidates for removal.

### 3. Uncertain Dependencies
List anything that needs caution before removal.

### 4. Used Environment Variables
List only variables actually read by source code.

### 5. Unused Environment Variables
List variables present in `.env.local.example` but not read anywhere.

### 6. Safe Removal Order
Propose the safest order for removing packages and env variables.

### 7. Verification Checklist
Define how to verify that cleanup did not break the project.

---

## RULES

- Base everything on real imports and actual source usage
- Be conservative
- Do not modify files
- Do not remove anything yet