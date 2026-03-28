"use client";

import { useEffect } from "react";

const THEME_PARAM = "theme";
const SAFE_THEME = /^[a-z0-9-]{1,40}$/;

export default function ThemeFromUrl() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get(THEME_PARAM) || "").trim().toLowerCase();
    const theme = SAFE_THEME.test(raw) ? raw : "";

    if (theme) document.body.dataset.theme = theme;
    else delete document.body.dataset.theme;
  }, []);

  return null;
}

