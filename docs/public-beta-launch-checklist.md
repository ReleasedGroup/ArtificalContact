# Public Beta Launch Checklist
## AI Practitioner Social Network

**Companion documents:** [requirements.md](requirements.md), [technical.md](technical.md), [sprint-plan.md](sprint-plan.md), [deployment.md](deployment.md), [testing.md](testing.md)  
**Sprint:** Sprint 8 — Moderation, Admin, Hardening, Public Beta  
**Purpose:** Provide the concrete go/no-go checklist required to open the product to invited beta users at the end of Sprint 8.

---

## 1. Exit Rule

Public beta can open only when every checklist item below is marked complete, the required evidence is linked, and Product, Engineering, and Operations have signed the release decision.

This checklist operationalises the Sprint 8 definition of done and the related requirements:

- `requirements.md` §9.1.1 for acceptance of terms and privacy policy
- `requirements.md` §12.5 for privacy obligations
- `requirements.md` §19 for first-release acceptance criteria
- `technical.md` §10 and §11 for security and observability controls
- `technical.md` §12 for production environment and on-call expectations
- `sprint-plan.md` Sprint 8 for launch readiness and invited beta access

---

## 2. Required Evidence

Each completed item must link to one or more concrete artifacts. Acceptable evidence includes:

- deployed URL and screenshot
- approved legal document or ticket
- PagerDuty schedule or equivalent on-call roster
- status-page component or incident-response URL
- launch email, changelog, or announcement draft
- runbook or admin guide
- test report, CI run, or synthetic-check output

If an item is not applicable, record the reason explicitly in the release notes instead of leaving it blank.

---

## 3. Checklist

### 3.1 Legal and Compliance

- [ ] **GDPR and privacy review signed off**  
  Owner: Product + Legal  
  Evidence: Approved sign-off record covering `requirements.md` §12.5 and the account deletion question in `technical.md` §15.

- [ ] **Terms of Service page is live**  
  Owner: Product  
  Evidence: Public URL for the current Terms of Service, plus confirmation that onboarding or sign-in links direct users to it.

- [ ] **Privacy Policy page is live**  
  Owner: Product  
  Evidence: Public URL for the current Privacy Policy, plus confirmation that onboarding or sign-in links direct users to it.

- [ ] **Terms/privacy acceptance path verified**  
  Owner: Engineering  
  Evidence: Test note or walkthrough confirming the beta signup flow satisfies `requirements.md` §9.1.1.

### 3.2 Reliability and Operations

- [ ] **Production status page is live**  
  Owner: Operations  
  Evidence: Public status-page URL covering the web app, API, and dependent services that matter for beta users.

- [ ] **On-call rota is active for the beta window**  
  Owner: Operations  
  Evidence: PagerDuty schedule or equivalent rota for launch week, including primary and secondary contacts.

- [ ] **Alerts route to the beta on-call rotation**  
  Owner: Operations  
  Evidence: Proof that the alerts called out in `technical.md` §11 notify the active rota, with at least one successful synthetic trip.

- [ ] **Launch runbook is available to responders**  
  Owner: Engineering  
  Evidence: Linked runbook covering rollback, incident triage, escalation path, and key dashboards.

### 3.3 Product and Communications

- [ ] **Beta announcement copy drafted**  
  Owner: Product/Marketing  
  Evidence: Final draft for the launch email, release note, or announcement post.

- [ ] **Support and moderation messaging drafted**  
  Owner: Product  
  Evidence: User-facing copy for reporting, support contact, expected response times, and beta caveats.

- [ ] **Invite list and admission policy approved**  
  Owner: Product  
  Evidence: Documented criteria for who receives access, invite volume per wave, and fallback plan if capacity needs to pause.

### 3.4 Access Control and Invite Flow

- [ ] **Invite mechanism implemented and tested**  
  Owner: Engineering  
  Evidence: Admin procedure or feature walkthrough showing how invited beta users are granted access and how non-invited users are blocked.

- [ ] **Invite-only access verified end to end**  
  Owner: QA/Engineering  
  Evidence: Test run covering both paths: invited user can complete the golden path, non-invited user is prevented from entering the beta.

- [ ] **Rollback path for invite access documented**  
  Owner: Engineering  
  Evidence: Runbook entry for pausing new invites or closing beta access without redeploy risk.

### 3.5 Product Readiness

- [ ] **Sprint 8 functional acceptance criteria met**  
  Owner: Engineering  
  Evidence: Linked test report covering `requirements.md` §19, excluding the explicitly post-beta GitHub sync criterion.

- [ ] **Golden path verified with a real beta account**  
  Owner: QA/Engineering  
  Evidence: Successful walkthrough of sign up, profile setup, post with media, follow, react, reply, search, and notifications, matching Sprint 8 definition of done.

- [ ] **Security, accessibility, and performance passes completed**  
  Owner: Engineering  
  Evidence: Sign-off or reports for the Sprint 8 hardening workstreams: CSP review, dependency scan, accessibility pass, and performance/load checks.

---

## 4. Sign-off

Use this block for the final go/no-go decision once every checklist item is complete.

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product |  |  |  |  |
| Engineering |  |  |  |  |
| Operations |  |  |  |  |

**Launch decision:** `GO / NO-GO`  
**Beta opening window:** `YYYY-MM-DD HH:MM TZ`  
**Issue tracker reference:** `#124`
