import "./driver-experience.css";
import DriverRequestAlerts from "@/components/DriverRequestAlerts";
import ChatMessageAlerts from "@/components/ChatMessageAlerts";

export default function DriverExperienceLayout({ children }) {
  return (
    <div className="driver-experience">
      {/* Global new-request alerts (Amir A6): watches all four
          eligibility-gated available feeds on every driver screen. */}
      <DriverRequestAlerts />
      {/* Global chat-message alerts (T-16): new chat messages surface
          on every driver screen, tap opens the chat. */}
      <ChatMessageAlerts role="DRIVER" />
      {children}
    </div>
  );
}
