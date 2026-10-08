/* V3-only: before/after comparison. Shared main.js is unchanged. */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-compare]").forEach(function (root) {
      var input = root.querySelector("input[type=range]");
      var before = root.querySelector(".compare__before");
      var img = before && before.querySelector("img");
      if (!input || !before || !img) return;
      var sync = function () {
        before.style.width = input.value + "%";
        img.style.width = root.clientWidth + "px";
        img.style.height = root.clientHeight + "px";
      };
      input.addEventListener("input", sync);
      window.addEventListener("resize", sync);
      sync();
    });
  });
})();
