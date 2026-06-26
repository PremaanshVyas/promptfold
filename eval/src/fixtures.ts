/**
 * Sanitized eval fixtures, synthetic conversations, no real user data.
 * Each exercises something the brief must get right.
 *
 * Real long-chat fixtures captured from your own account go in eval/fixtures/
 * (git-ignored unless sanitized) and are loaded the same way.
 */

import type { Fixture } from "./harness.js";

function user(uuid: string, text: string, parent?: string) {
  return { uuid, parent_message_uuid: parent, sender: "human", content: [{ type: "text", text }] };
}
function asst(uuid: string, text: string, parent?: string) {
  return { uuid, parent_message_uuid: parent, sender: "assistant", content: [{ type: "text", text }] };
}

export const FIXTURES: Fixture[] = [
  {
    id: "db-choice",
    description:
      "A database decision with a rejected alternative and a value that changed mid-chat.",
    nextQuestion: "What database and connection timeout should I configure, and why not the alternative?",
    conversation: {
      uuid: "fixture-db-choice",
      name: "Pick a database",
      current_leaf_message_uuid: "m6",
      chat_messages: [
        user("m1", "I need a datastore for a small SaaS. Considering DynamoDB or Postgres."),
        asst(
          "m2",
          "Let's weigh them. DynamoDB is great at scale but your access patterns are relational (joins across users/orgs/projects). That makes Postgres a better fit here.",
          "m1",
        ),
        user("m3", "Okay let's go with Postgres then. Set a connection timeout of 30s.", "m2"),
        asst(
          "m4",
          "Sounds good. Postgres it is, and I'll rule out DynamoDB because your joins would force expensive client-side stitching. Timeout set to 30s.",
          "m3",
        ),
        user("m5", "Actually 30s is too short under load, bump the timeout to 60s.", "m4"),
        asst(
          "m6",
          "Updated: connection timeout is now 60s. Also, you'll want to wire this in your real db.ts. I only saw a snippet of it, not the pool config.",
          "m5",
        ),
      ],
    },
  },
  {
    id: "auth-approach",
    description: "A non-coding-heavy decision chat with an explicitly rejected approach.",
    nextQuestion: "How should we handle auth, and what did we decide against?",
    conversation: {
      uuid: "fixture-auth",
      name: "Auth approach",
      current_leaf_message_uuid: "a4",
      chat_messages: [
        user("a1", "Should we roll our own session auth or use a provider?"),
        asst(
          "a2",
          "Rolling your own means owning password resets, breach response, and MFA, a lot of risk for a small team. I'd use a managed provider.",
          "a1",
        ),
        user("a3", "Agreed, no custom auth. Use Clerk.", "a2"),
        asst(
          "a4",
          "Decided: Clerk for auth. Rejected: custom session auth, because the security maintenance burden (resets, MFA, breach handling) isn't worth it for a small team.",
          "a3",
        ),
      ],
    },
  },
];
