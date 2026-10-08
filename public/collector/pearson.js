/*
 * MyLab collector. Paste this into the DevTools console while you are signed in
 * on a Pearson Results / gradebook page (the frame that actually shows the tables).
 *
 * READ-ONLY. This file does not call fetch, does not click, and does not submit.
 * It copies text and links that are already on the page into a JSON download.
 * Grade interpretation happens later, in the dashboard import.
 */
(function () {
  "use strict";
  var host = location.hostname.toLowerCase();
  if (host !== "pearson.com" && host.slice(-12) !== ".pearson.com") {
    console.error("Run this on a pearson.com page while signed in. Nothing was saved.");
    return;
  }
  if (location.protocol !== "https:") {
    console.error("Refusing a non-https page. Nothing was saved.");
    return;
  }
  var path = location.pathname.toLowerCase();
  if (!/results|gradebook/.test(path)) {
    console.error("Open the MyLab Results / gradebook page, then run this again. Nothing was saved.");
    return;
  }

  function text(node) {
    if (!node) return "";
    return String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function linksOf(node) {
    var out = [];
    if (!node || !node.querySelectorAll) return out;
    var anchors = node.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute("href") || "";
      if (!href) continue;
      out.push({ href: href, text: text(anchors[i]) || null });
    }
    return out;
  }

  function cellPayload(cell) {
    var clone = cell.cloneNode(true);
    var drop = clone.querySelectorAll("i, svg, img, .readableButHidden, sup");
    for (var i = drop.length - 1; i >= 0; i--) drop[i].remove();
    var rawClone = cell.cloneNode(true);
    var rawDrop = rawClone.querySelectorAll("i, svg, img, .readableButHidden");
    for (var j = rawDrop.length - 1; j >= 0; j--) rawDrop[j].remove();
    return {
      tag: cell.tagName.toLowerCase(),
      colspan: Number(cell.getAttribute("colspan")) || 1,
      text: String(clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim(),
      raw: String(rawClone.innerText || rawClone.textContent || "").replace(/\s+/g, " ").trim(),
      hasSup: !!cell.querySelector("sup"),
      links: linksOf(cell),
    };
  }

  function footerText() {
    var body = document.body ? document.body.innerText || "" : "";
    var at = body.lastIndexOf("This course");
    if (at >= 0) return body.slice(at, at + 2000);
    return body.slice(-4000);
  }

  function viewLabel() {
    var sels = ["select[id*='DateRange']", "select[id*='dateRange']", "select[id*='Range']"];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el && el.selectedOptions && el.selectedOptions[0]) {
        var value = text(el.selectedOptions[0]);
        if (value && value.length < 80) return value;
      }
    }
    return null;
  }

  var overallValue = document.querySelector("#overallScore .score-value");
  var detailNodes = document.querySelectorAll("#overall-score-details p");
  var details = [];
  for (var d = 0; d < detailNodes.length; d++) details.push(detailNodes[d].textContent || "");
  var categoryTable = document.querySelector("#ctl00_ctl00_InsideForm_MasterContent_OverallScoreGrid, table.table-overall-score");

  function rowCells(tr) {
    var cells = [];
    for (var i = 0; i < tr.children.length; i++) {
      var child = tr.children[i];
      if (!/^(TD|TH)$/.test(child.tagName)) continue;
      cells.push(text(child));
    }
    return cells;
  }

  var categoryHeaders = [];
  var categoryRows = [];
  var categoryTotal = null;
  if (categoryTable) {
    var heads = categoryTable.querySelectorAll("thead th");
    for (var h = 0; h < heads.length; h++) categoryHeaders.push(text(heads[h]));
    var bodyRows = categoryTable.querySelectorAll("tbody tr");
    for (var r = 0; r < bodyRows.length; r++) {
      var nameCell = bodyRows[r].querySelector("th");
      categoryRows.push({ name: text(nameCell), cells: rowCells(bodyRows[r]).slice(nameCell ? 1 : 0) });
    }
    var foot = categoryTable.querySelector("tfoot tr");
    if (foot) categoryTotal = { name: text(foot.querySelector("th")) || "Total", cells: rowCells(foot).slice(foot.querySelector("th") ? 1 : 0) };
  }

  var tables = document.querySelectorAll("table.table-inner-bordered");
  var assignmentHeaders = [];
  var assignmentRows = [];
  for (var t = 0; t < tables.length; t++) {
    if (categoryTable && (tables[t] === categoryTable || tables[t].contains(categoryTable))) continue;
    if (!assignmentHeaders.length) {
      var ths = tables[t].querySelectorAll("thead th");
      for (var c = 0; c < ths.length; c++) assignmentHeaders.push({ text: text(ths[c]), colspan: Number(ths[c].getAttribute("colspan")) || 1 });
    }
    var rows = tables[t].querySelectorAll("tbody tr[id^='row']");
    for (var n = 0; n < rows.length; n++) {
      var tr = rows[n];
      var titleCell = tr.querySelector("th.leftcol") || tr.querySelector("th");
      var hidden = titleCell ? titleCell.querySelector("span.readableButHidden") : null;
      var titleClone = titleCell ? titleCell.cloneNode(true) : null;
      if (titleClone) {
        var hiddenBits = titleClone.querySelectorAll("i, svg, img, span.readableButHidden");
        for (var b = hiddenBits.length - 1; b >= 0; b--) hiddenBits[b].remove();
      }
      var cells = [];
      for (var k = 0; k < tr.children.length; k++) {
        var el = tr.children[k];
        if (!/^(TD|TH)$/.test(el.tagName)) continue;
        cells.push(cellPayload(el));
      }
      assignmentRows.push({
        title: titleClone ? text(titleClone) : "",
        category: hidden ? text(hidden).replace(/[:\-–\s]+$/, "") : null,
        className: tr.className || "",
        cells: cells,
      });
      if (assignmentRows.length >= 500) break;
    }
  }

  if (!text(overallValue) && !details.join("").trim() && !categoryRows.length && !assignmentRows.length) {
    var framed = window.frames && window.frames.length;
    console.error(framed
      ? "No Results tables in this document. The gradebook may be in an iframe. Select that frame in DevTools and run the script there. Nothing was saved."
      : "No Results tables found. Nothing was saved.");
    return;
  }

  var footer = footerText();
  var ids = footer.match(/\d{4}_(?:FALL|SPRING|SUMMER|WINTER)_[A-Z]{2,5}_\d{3,5}_SEC\w+/gi) || [];
  var unique = {};
  ids.forEach(function (id) { unique[id.toUpperCase()] = true; });
  var idList = Object.keys(unique);
  var filename = idList.length === 1 ? "mylab-" + idList[0] + ".json" : "mylab-capture-" + Date.now() + ".json";
  var capture = {
    kind: "pearson-capture",
    collector: "pearson-console",
    collectorVersion: 1,
    capturedAt: new Date().toISOString(),
    pageUrl: location.origin + location.pathname,
    footerText: footer,
    overallValueText: text(overallValue) || null,
    overallDetailsText: details.join(" ") || null,
    viewLabel: viewLabel(),
    categoryHeaders: categoryHeaders,
    categoryRows: categoryRows,
    categoryTotal: categoryTotal,
    assignmentHeaders: assignmentHeaders,
    assignmentRows: assignmentRows,
  };
  var blob = new Blob([JSON.stringify(capture, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log("Saved " + filename + ". Categories: " + categoryRows.length + ". Assignments: " + assignmentRows.length + ". Import this file into Mirror. Nothing was submitted.");
})();
