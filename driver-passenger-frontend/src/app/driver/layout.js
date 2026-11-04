import "./driver-experience.css";
import DriverRequestAlerts from "@/components/DriverRequestAlerts";
import ChatMessageAlerts from "@/components/ChatMessageAlerts";
import DriverRideDock from "@/components/driver/ride/DriverRideDock";
import DriverSetupBoundary from "@/components/driver/setup/DriverSetupBoundary";

export default function DriverExperienceLayout({ children }) {
  return (
    <DriverSetupBoundary>
      <div className="driver-experience">
        {/* Global new-request alerts (Amir A6): watches all four
            eligibility-gated available feeds on every driver screen. */}
        <DriverRequestAlerts />
        {/* Global chat-message alerts (T-16): new chat messages surface
            on every driver screen, tap opens the chat. */}
        <ChatMessageAlerts role="DRIVER" />
        {children}
        {/* Always-visible way back to the current ride or waiting rides. */}
        <DriverRideDock />
      </div>
    </DriverSetupBoundary>
  );
}
