export type BenefitPageState =
  | "loading"
  | "idle"
  | "verifying"
  | "claiming"
  | "provisioning"
  | "ready"
  | "error"
  | "disabled";

export type BenefitPanel = "progress" | "claim" | "ready" | "error" | "disabled";

const panelByState: Record<BenefitPageState, BenefitPanel> = {
  loading: "progress",
  idle: "claim",
  verifying: "progress",
  claiming: "progress",
  provisioning: "progress",
  ready: "ready",
  error: "error",
  disabled: "disabled"
};

export function benefitPanelForState(state: BenefitPageState): BenefitPanel {
  return panelByState[state];
}
