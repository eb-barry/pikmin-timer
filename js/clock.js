export function clockButton({ id, size, empty = false }) {
  return `<button type="button" class="clock clock-${size}${empty ? " clock-empty" : " is-live"}" data-id="${id}" data-size="${size}"${empty ? ' data-empty="1"' : ""}>
    <img class="art" src="./assets/clock.png" alt="" draggable="false">
    <span class="face">
      <span class="face-hit">
        <span class="place">${placeIcons()}<span class="place-name" data-part="place"></span></span>
        <span class="digits" data-part="digits" lang="en">--:--:--</span>
        <span class="end-label">結束時間</span>
        <span class="end-pill" data-part="end" lang="en">--:--</span>
      </span>
    </span>
  </button>`;
}

function placeIcons() {
  return `<span class="place-icons" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.2v4.4l2.6 1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><svg viewBox="0 0 24 24"><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="11" r="2.1" fill="currentColor"/></svg></span>`;
}
