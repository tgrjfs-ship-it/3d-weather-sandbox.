import React from "react";
import { createRoot } from "react-dom/client";
import VolumetricClouds from "./VolumetricClouds.jsx";

const App = () => {
  return (
    <div className="container">
      <VolumetricClouds />
    </div>
  );
};

createRoot(document.getElementById("app")).render(<App />);