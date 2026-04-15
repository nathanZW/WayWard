import { memo } from "react";
import { APP_TABS } from "../types/domain";
import { useUiStore } from "../stores/useUiStore";

function TabsBar() {
  const activeTab = useUiStore((state) => state.activeTab);
  const setActiveTab = useUiStore((state) => state.setActiveTab);

  return (
    <div className="tabs">
      {APP_TABS.filter((tab) => tab !== "Queue").map((tab) => (
        <div
          key={tab}
          className={`tab ${activeTab === tab ? "active" : ""}`}
          onClick={() => setActiveTab(tab)}
        >
          {tab}
        </div>
      ))}
    </div>
  );
}

export default memo(TabsBar);
