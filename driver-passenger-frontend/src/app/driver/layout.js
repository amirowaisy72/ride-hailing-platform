import "./driver-experience.css";
import DriverRequestAlerts from "@/components/DriverRequestAlerts";

export default function DriverExperienceLayout({ children }) {
  return (
    <div className="driver-experience">
      {/* Global new-request alerts (Amir A6): watches all four
          eligibility-gated available feeds on every driver screen. */}
      <DriverRequestAlerts />
      {children}
    </div>
  );
}
