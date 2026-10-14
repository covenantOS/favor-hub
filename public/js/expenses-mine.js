/* My requests on /expenses: the signed-in person's own expense requests, from /api/expenses?mine=1. */
(function () {
  var host = document.getElementById("exp-mine-list");
  if (!host) return;
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var money = function (cents) {
    return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var fmt = function (iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  };
  var STATUS = { pending: "Waiting", approved: "Approved", declined: "Declined" };
  var EVENTS = { submitted: "Submitted", approved: "Approved and signed", declined: "Declined", approver_reassigned: "Approver changed" };

  function detail(r) {
    var lines = r.items.map(function (it) {
      return "<tr><td>" + esc(it.description) + (it.item ? ' <span class="exp-mine__dim">&middot; ' + esc(it.item) + "</span>" : "") +
        '</td><td class="r">' + money(it.amount_cents) + "</td></tr>";
    }).join("");
    var sigs = (r.requester_signature || r.approver_signature)
      ? '<div class="exp-detail-sigs">' +
        (r.requester_signature ? '<div><img src="' + esc(r.requester_signature) + '" alt="Your signature" /><span>' + esc(r.requester_name) + " &middot; requester</span></div>" : "") +
        (r.approver_signature ? '<div><img src="' + esc(r.approver_signature) + '" alt="Approver signature" /><span>' + esc(r.approver_name) + " &middot; approver</span></div>" : "") +
        "</div>" : "";
    var events = (r.events || []).map(function (ev) {
      return '<li><div class="exp-tl-row"><b>' + esc(EVENTS[ev.kind] || ev.kind) + "</b><span>" + esc(ev.actor) + " &middot; " + fmt(ev.created_at) + "</span></div></li>";
    }).join("");
    return '<div class="exp-detail">' +
      '<div class="exp-rows"><b>Dates</b><span>' + (esc(r.travel_dates) || "&mdash;") + "</span>" +
      "<b>City / state</b><span>" + (esc(r.travel_city) || "&mdash;") + "</span>" +
      "<b>Reason</b><span>" + esc(r.reason) + "</span>" +
      "<b>Approver</b><span>" + esc(r.approver_name) + "</span>" +
      (r.decline_note ? "<b>Decline note</b><span>" + esc(r.decline_note) + "</span>" : "") + "</div>" +
      '<table class="exp-table"><tr><th>Item</th><th class="r">Amount</th></tr>' + lines +
      '<tr class="tot"><td>Total</td><td class="r">' + money(r.total_cents) + "</td></tr></table>" +
      sigs + (events ? '<span class="exp-legend">Timeline</span><ul class="exp-timeline">' + events + "</ul>" : "") +
      "</div>";
  }

  function paint(rows) {
    if (!rows.length) {
      host.innerHTML = '<p class="exp-empty">You have not filed an expense request yet. <a href="/expenses/new">Start one</a>.</p>';
      return;
    }
    host.innerHTML = rows.map(function (r, i) {
      return '<article class="exp-mine-item">' +
        '<button type="button" class="exp-mine-row" aria-expanded="false" aria-controls="exp-mine-d' + i + '">' +
        '<span class="exp-mine-doc">' + esc(r.doc_number) + "</span>" +
        '<span class="exp-mine-date">' + fmt(r.submitted_at) + "</span>" +
        '<span class="exp-mine-tot">' + money(r.total_cents) + "</span>" +
        '<span class="exp-mine-st"><span class="exp-pill ' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + "</span></span>" +
        '<span class="exp-mine-appr">' + esc(r.approver_name) + "</span></button>" +
        '<a class="exp-pdf-link exp-mine-pdf" href="' + esc(r.pdf) + '" download>Download PDF</a>' +
        '<div class="exp-mine-detail" id="exp-mine-d' + i + '" hidden>' + detail(r) + "</div></article>";
    }).join("");
    host.querySelectorAll(".exp-mine-row").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var d = document.getElementById(btn.getAttribute("aria-controls"));
        var open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        d.hidden = !open;
      });
    });
  }

  fetch("/api/expenses?mine=1", { credentials: "same-origin" })
    .then(function (res) {
      return res.json().then(function (data) {
        if (res.status === 401 || (data && data.error === "signin")) { window.location.href = "/login/?next=" + encodeURIComponent(window.location.pathname); return null; }
        if (!res.ok || data.ok === false) throw new Error(data.message || "Request failed");
        return data;
      });
    })
    .then(function (data) { if (data) paint(data.requests || []); })
    .catch(function () { host.innerHTML = '<p class="exp-empty">Your requests did not load. Refresh the page to try again.</p>'; });
})();
