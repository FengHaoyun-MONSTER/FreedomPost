import QRCode from "qrcode";

interface LocalQrEncoder {
  toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options: {
      errorCorrectionLevel: "M";
      margin: number;
      width: number;
      color: { dark: string; light: string };
    }
  ): Promise<void>;
}

const qrOptions = {
  errorCorrectionLevel: "M",
  margin: 2,
  width: 300,
  color: { dark: "#111714", light: "#ffffff" }
} as const;

export function renderSubscriptionQr(
  canvas: HTMLCanvasElement,
  subscriptionUrl: string,
  encoder: LocalQrEncoder = QRCode
): Promise<void> {
  return encoder.toCanvas(canvas, subscriptionUrl, qrOptions);
}
