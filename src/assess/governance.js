import { fail } from '../lib/errors.js';

/**
 * Derives Governance output parameters based on Level and findings (Specification §2.4 & §6.1)
 * Supports 3 workflow modes: 'supervised' (default), 'spec-first', 'auto'.
 */
export function deriveGovernance({ level, confidence, mandatory_human_review = false, mode = 'supervised' } = {}) {
  let workflow_mode = 'single-pr';
  let spec_approval = 'not-applicable';
  let implementation_review = 'ai+human';
  let auto_approval = 'disabled';

  const normMode = String(mode || 'supervised').toLowerCase().trim();

  if (normMode === 'single-pr') {
    fail("Configured mode cannot be 'single-pr'. Valid modes are: 'supervised', 'spec-first', 'auto'. Single-PR is an internal topology granted to L0/L1 changes.", {
      code: 'INVALID_WORKFLOW_MODE',
      hint: "Use 'supervised' (default), 'spec-first', or 'auto'."
    });
  }

  if (!['supervised', 'spec-first', 'auto'].includes(normMode)) {
    fail(`Invalid workflow mode '${mode}'. Allowed modes: supervised, spec-first, auto`, {
      code: 'INVALID_WORKFLOW_MODE',
      hint: "Choose one of 'supervised', 'spec-first', 'auto'."
    });
  }

  if (normMode === 'spec-first') {
    // Under spec-first, all levels (L0-L3) force Dual-PR, human spec approval, and human implementation review
    workflow_mode = 'spec-first';
    spec_approval = 'human';
    implementation_review = 'ai+human';
    auto_approval = 'disabled';
  } else if (normMode === 'supervised') {
    // Under supervised (default): L0/L1 get Single-PR agility, but auto-merge is disabled (human review required)
    switch (level) {
      case 'L0':
        workflow_mode = 'single-pr';
        spec_approval = 'not-applicable';
        implementation_review = 'ai+human';
        auto_approval = 'disabled';
        break;

      case 'L1':
        workflow_mode = 'single-pr';
        spec_approval = 'automatic';
        implementation_review = 'ai+human';
        auto_approval = 'disabled';
        break;

      case 'L2':
      case 'L3':
      default:
        workflow_mode = 'spec-first';
        spec_approval = 'human';
        implementation_review = 'ai+human';
        auto_approval = 'disabled';
        break;
    }
  } else if (normMode === 'auto') {
    // Under auto (autonomous): L0/L1 get Single-PR and AI auto-merge; L2/L3 get Dual-PR
    switch (level) {
      case 'L0':
        workflow_mode = 'single-pr';
        spec_approval = 'not-applicable';
        implementation_review = 'ai';
        auto_approval = 'enabled';
        break;

      case 'L1':
        workflow_mode = 'single-pr';
        spec_approval = 'automatic';
        implementation_review = 'ai';
        auto_approval = 'enabled';
        break;

      case 'L2':
      case 'L3':
      default:
        workflow_mode = 'spec-first';
        spec_approval = 'human';
        implementation_review = 'ai+human';
        auto_approval = 'disabled';
        break;
    }
  }

  // Safety Overrides
  if (mandatory_human_review || confidence === 'low') {
    implementation_review = 'ai+human';
    auto_approval = 'disabled';
  }

  return {
    workflow_mode,
    spec_approval,
    implementation_review,
    auto_approval,
    mode: normMode
  };
}
