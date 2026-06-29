function setupPageNav(roomId, activePage) {
  document.querySelectorAll(".page-nav a").forEach((link) => {
    const page = link.getAttribute("href").split("?")[0];
    link.href = `${page}?room=${encodeURIComponent(roomId)}`;
    link.classList.toggle("active", page === activePage);
  });
}

function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let room = (params.get("room") || "").trim();
  if (!room) {
    room = "audit-looker";
    params.set("room", room);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  return room.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

window.PageUtils = { setupPageNav, getRoomIdFromUrl };
