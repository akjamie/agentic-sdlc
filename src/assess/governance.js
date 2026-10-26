/**
 * Derives Governance output parameters based on Level and findings (Specification §2.4 & §6.1)
 */
export function deriveGovernance({ level, confidence, mandatory_human_review = false } = {}) {
  let workflow_mode = 'single-pr';
  let spec_approval = 'not-applicable';
  let implementation_review = 'ai';
  let auto_approval = 'enabled';

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
      workflow_mode = 'spec-first';
      spec_approval = 'human';
      implementation_review = 'ai+human';
      auto_approval = 'disabled';
      break;

    case 'L3':
    default:
      workflow_mode = 'spec-first';
      spec_approval = 'human';
      implementation_review = 'ai+human';
      auto_approval = 'disabled';
      break;
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
    auto_approval
  };
}
