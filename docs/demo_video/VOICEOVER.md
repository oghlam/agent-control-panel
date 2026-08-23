# Demo Video Voice-Over Script (~4 minutes)

> Pace: ~145 words/minute. Bracketed cues match the shot list in
> `DEVPOST_SUBMISSION.md`. Read conversationally, not salesy.

---

### [0:00–0:30] The problem

Every day, sales inboxes fill up with the same chore. A customer asks for a
quotation. Someone has to read the email, check the stock, look up the
customer, write the numbers, send the reply — five manual steps, spread across
four tools, with zero trace of who did what. It works, until it doesn't
scale. And if you automate it naively, you get the opposite problem: an agent
nobody can inspect, running actions nobody approved.

### [0:30–1:00] The value proposition

Agent Control Plane is different. It runs the entire chain autonomously in the
background — ingestion, planning, tool calls, delivery — but every risky step
passes through a control plane. Humans approve only what policy flags. Every
decision, every tool call, every approval is recorded in an immutable audit
trail. Autonomy with governance, by design.

### [1:00–1:20] Architecture

Here's the system. A Next.js dashboard talks to a FastAPI backend on Cloud
Run. The agent runtime is Google's Agent Development Kit running Gemini 3.5
Flash through Vertex AI. Tool calls never touch external systems directly —
they pass through a Tool Gateway that enforces role-based access, risk levels,
and rate limits backed by Firestore. Webhooks and an IMAP daemon feed real
events in. Everything lands in Firestore: state, results, and the audit trace.

### [1:20–1:40] Proof it runs on Google Cloud

This is not a localhost demo. Both services are live on Cloud Run — here's the
Cloud Run dashboard, here are the public run.app URLs, and here are the
structured JSON logs streaming into Cloud Logging with severity levels.

### [1:40–2:40] Live demo — ingestion to completion

Now watch it work. A customer email arrives asking for forty solar panels.
The ingestion pipeline creates an execution instantly — it's already in the
queue, waiting for approval. I sign in with my Google identity — the system
verifies the token and records exactly who I am. I approve. The execution
moves to QUEUED, then RUNNING — the Gemini agent checks inventory, pulls the
customer record, and generates the quotation through the gateway. Seconds
later: COMPLETED. The result is right there — quotation prepared, priced, and
delivered to the customer.

### [2:40–3:20] Governance in action

And here's the part most agent demos skip. I open the trace — every lifecycle
event is timestamped, and the approval is signed with a verified Google
identity: subject, email, name. Now the Tool Gateway: the same tool call
behaves differently by role. An agent role hits the policy — rejected. Rate
limit exceeded — blocked, with the sliding window visible in the metrics.
Through the MCP protocol tab, the same tools are exposed over JSON-RPC with
typed schemas — still behind the same security boundary.

### [3:20–3:50] The autonomous twist

Approval is a policy, not a limitation. Watch: same workflow, approval
disabled. No human touches anything. The email arrives, the agent plans,
executes every tool call, and completes the delivery — end to end, fully
autonomous, and still fully audited. You can see it in the terminal and in
Firestore as it happens.

### [3:50–4:00] Close

Agents that act, governed by design. Agent Control Plane — built on Gemini,
Google ADK, and Google Cloud.

---

## Recording notes

- Total narration ≈ 585 words → ~4:00 at a relaxed pace.
- Record screen at 1600×900 or 1920×1080; the automated footage in
  `docs/demo_video/acp_demo_walkthrough.mp4` (80s) can be spliced into the
  1:40–3:20 section.
- The only shots needing a human: Google sign-in popup and the Approve click.
- Show unedited terminal/Firestore writes during 3:20–3:50 (Proof of Action).
- Add English captions if narrating with an accent; judges reward clarity.
- Music: optional, keep it under the voice; avoid copyrighted tracks.
