/* ==========================================================================
   ProTec Dental Laboratory — main.js
   Small, dependency-free enhancements shared by every page:
     1. Mark JS as available (enables reveal animations in CSS)
     2. Mobile navigation toggle
     3. Header shadow on scroll
     4. Reveal-on-scroll animations
     5. Footer year
     6. Form helper (warns while the form isn't connected to a handler yet)
   ========================================================================== */
(function () {
  "use strict";

  // 1. JS available ---------------------------------------------------------
  document.documentElement.classList.add("js");

  document.addEventListener("DOMContentLoaded", function () {
    // 2. Mobile navigation ----------------------------------------------------
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.getElementById("site-nav");
    if (toggle && nav) {
      var setOpen = function (open) {
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        nav.classList.toggle("is-open", open);
      };
      toggle.addEventListener("click", function () {
        setOpen(toggle.getAttribute("aria-expanded") !== "true");
      });
      // Close on Escape or when a link is chosen
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
      });
      nav.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
      // Reset when resizing back to desktop
      window.matchMedia("(min-width: 921px)").addEventListener("change", function (mq) { if (mq.matches) setOpen(false); });
    }

    // 3. Header shadow --------------------------------------------------------
    var header = document.querySelector(".site-header");
    if (header) {
      var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // 4. Reveal on scroll -----------------------------------------------------
    var revealEls = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && revealEls.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    }

    // 5. Footer year ----------------------------------------------------------
    document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

    // 6. Form helper ----------------------------------------------------------
    // Forms ship with action="#" (not connected). Until you add Formspree or a
    // PHP handler (see README), submitting shows a friendly notice instead of
    // silently failing. Once `action` points somewhere real, this does nothing.
    document.querySelectorAll("form[data-protec-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        var status = form.querySelector(".form-status");
        var action = form.getAttribute("action") || "";
        if (!form.checkValidity()) return; // let the browser show validation messages
        if (action === "" || action === "#") {
          e.preventDefault();
          if (status) {
            status.hidden = false;
            status.innerHTML = "<div class='note' role='status'><p><strong>Mockup only:</strong> this form isn't connected yet. " +
              "Please call <a href='tel:+61398865414'>03 9886 5414</a> or email <a href='mailto:info@proteclab.com.au'>info@proteclab.com.au</a>.</p></div>";
            status.focus();
          }
        }
      });
    });
  });
})();
