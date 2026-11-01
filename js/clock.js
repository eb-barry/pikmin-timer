export function clockButton({ id, size, empty = false }) {
  return `<button type="button" class="clock clock-${size}${empty ? " clock-empty" : " is-live"}" data-id="${id}" data-size="${size}"${empty ? ' data-empty="1"' : ""}>
    <img class="art" src="./assets/clock.png" alt="" draggable="false">
    <span class="face">
      <span class="face-hit">
        <span class="place"><span class="place-name" data-part="place"></span></span>
        <span class="digits" data-part="digits" lang="en">--:--:--</span>
        <span class="end-label">結束時間</span>
        <span class="end-pill" data-part="end" lang="en">--:--</span>
      </span>
    </span>
  </button>`;
}
