import "./LoadingIndicator.css";

type LoadingIndicatorProps = {
  label?: string;
  fullPage?: boolean;
};

export default function LoadingIndicator({
  label = "Inventar wird geladen …",
  fullPage = false,
}: LoadingIndicatorProps) {
  return (
    <div className={`brand-loading${fullPage ? " brand-loading-page" : ""}`} role="status" aria-live="polite">
      <img className="brand-loading-logo" src="/logo.png" alt="ITAssetFlow" width="240" />
      <div className="brand-loading-track" aria-hidden="true"><span /></div>
      <span className="brand-loading-label">{label}</span>
    </div>
  );
}
