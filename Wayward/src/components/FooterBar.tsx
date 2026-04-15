import { memo } from "react";
import { PlusCircle } from "lucide-react";

function FooterBar() {
  return (
    <div className="footer">
      <div>Alt+W to open</div>
      <div className="footer-icon">
        <PlusCircle size={14} /> Last.fm live data
      </div>
    </div>
  );
}

export default memo(FooterBar);
