---
name: asdlc-approve
description: "Stage 4: Lock approvedSha and transition change to READY_FOR_IMPL"
---

# /asdlc-approve - Approve Spec & Cryptographic Lock

Lock the approved specification state and unlock implementation for the change.

## Usage

```bash
asdlc approve <CHANGE_ID>
```

## Behavior

1. Evaluates human lead approval (or PR merge commit on target branch).
2. Computes and locks cryptographic `approvedSha` for the spec files.
3. Stamps `review.md` with `verdict: APPROVE` and `specSha`.
4. Transitions change state to `READY_FOR_IMPL`.
