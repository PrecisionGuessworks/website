// ====== TEAM CALENDAR DATA ======
// Shared by the homepage Team Calendar (index.html) and the Canvas embed
// (calendar-embed.html). Fetches events from the team's public Google
// Calendar and normalizes them into team-local time. Exposed as
// window.TeamCalendar.
(function () {
  // ---- Configuration -------------------------------------------------------
  // The team's public Google Calendar (Settings > Integrate calendar).
  var CALENDAR_ID = 'firstpg1646@gmail.com';

  // ===========================================================================
  // >>>>>>>>>>>>>>>>>>>>  PASTE THE GOOGLE API KEY HERE  <<<<<<<<<<<<<<<<<<<<<<
  // Replace PASTE_API_KEY_HERE below with the key (keep the quotes), e.g.
  //   var API_KEY = 'AIzaSy...';
  // Until it's set, the calendar shows a "coming soon" message.
  // The key is restricted to bronchorobotics.org referrers in Google Cloud.
  // ===========================================================================
  var API_KEY = 'AIzaSyC9v4IUfIg5heSO-fa71vt9EayCeH8FOKQ';

  // Events are shown in the team's local time, wherever the visitor is.
  var TIME_ZONE = 'America/Indiana/Indianapolis';

  var fmtZoneParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  });

  // ---- Data ----------------------------------------------------------------
  // Resolves to normalized events sorted by start time. Accepts Date objects
  // (real instants) for timeMin/timeMax.
  function fetchEvents(options) {
    var url = 'https://www.googleapis.com/calendar/v3/calendars/'
      + encodeURIComponent(CALENDAR_ID) + '/events'
      + '?key=' + encodeURIComponent(API_KEY)
      + '&singleEvents=true&orderBy=startTime'
      + '&maxResults=' + (options.maxResults || 250)
      + '&timeMin=' + encodeURIComponent(options.timeMin.toISOString())
      + (options.timeMax
        ? '&timeMax=' + encodeURIComponent(options.timeMax.toISOString()) : '');
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('Calendar request failed');
      return response.json();
    }).then(function (data) {
      return (data.items || []).filter(function (item) {
        return item.status !== 'cancelled' && item.start;
      }).map(normalize).sort(function (a, b) { return a.start - b.start; });
    });
  }

  function normalize(item) {
    var allDay = !!item.start.date;
    var start = allDay ? parseDate(item.start.date) : toTeamTime(new Date(item.start.dateTime));
    var end = allDay ? parseDate(item.end.date) : toTeamTime(new Date(item.end.dateTime));
    return {
      title: item.summary || 'Untitled event',
      allDay: allDay,
      start: start,
      // End is exclusive; give zero-length events a sliver of duration.
      end: end > start ? end : new Date(start.getTime() + 1),
      location: item.location || '',
      description: stripHtml(item.description || ''),
      descriptionHtml: item.description || '',
      link: item.htmlLink || ''
    };
  }

  // ---- Descriptions --------------------------------------------------------
  function stripHtml(html) {
    var doc = new DOMParser().parseFromString(
      html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
    return (doc.body.textContent || '').trim();
  }

  // Rebuilds a Google Calendar description (HTML or plain text) as safe DOM:
  // only text, line breaks, and links survive. Links open in a new tab, and
  // bare URLs in the text become links too. Pair with white-space: pre-line.
  var BLOCK_TAGS = /^(P|DIV|LI|UL|OL|H[1-6]|TR|TABLE|BLOCKQUOTE)$/;
  var URL_PATTERN = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'}]/g;

  function descriptionFragment(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var frag = document.createDocumentFragment();
    copyNodes(doc.body, frag);
    trimFragment(frag);
    return frag;
  }

  function copyNodes(source, target) {
    Array.prototype.forEach.call(source.childNodes, function (node) {
      if (node.nodeType === 3) {
        appendLinkified(target, node.nodeValue);
      } else if (node.nodeType !== 1) {
        return;
      } else if (node.tagName === 'BR') {
        target.appendChild(document.createTextNode('\n'));
      } else if (node.tagName === 'A' && safeHref(node.getAttribute('href'))) {
        var text = node.textContent;
        target.appendChild(makeLink(node.getAttribute('href'), text.trim() ? text : node.getAttribute('href')));
      } else if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
        var block = BLOCK_TAGS.test(node.tagName);
        if (block) target.appendChild(document.createTextNode('\n'));
        copyNodes(node, target);
        if (block) target.appendChild(document.createTextNode('\n'));
      }
    });
  }

  function appendLinkified(target, text) {
    var last = 0;
    text.replace(URL_PATTERN, function (url, index) {
      if (index > last) target.appendChild(document.createTextNode(text.slice(last, index)));
      target.appendChild(makeLink(url, url));
      last = index + url.length;
    });
    if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
  }

  function makeLink(href, text) {
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    return a;
  }

  function safeHref(href) {
    return !!href && /^(https?:|mailto:)/i.test(href.trim());
  }

  // Drops leading/trailing whitespace and collapses runs of blank lines.
  function trimFragment(frag) {
    frag.normalize();
    var nodes = frag.childNodes;
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.nodeType === 3) node.nodeValue = node.nodeValue.replace(/\n{3,}/g, '\n\n');
    });
    if (nodes.length && nodes[0].nodeType === 3) {
      nodes[0].nodeValue = nodes[0].nodeValue.replace(/^\s+/, '');
    }
    var lastNode = nodes[nodes.length - 1];
    if (lastNode && lastNode.nodeType === 3) {
      lastNode.nodeValue = lastNode.nodeValue.replace(/\s+$/, '');
    }
  }

  // ---- Dates ---------------------------------------------------------------
  // Re-expresses an instant as the same wall-clock time in TIME_ZONE, so all
  // date math and formatting happens in team-local time.
  function toTeamTime(date) {
    var p = {};
    fmtZoneParts.formatToParts(date).forEach(function (part) { p[part.type] = +part.value; });
    return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  function parseDate(s) {
    var p = s.split('-');
    return new Date(+p[0], p[1] - 1, +p[2]);
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  window.TeamCalendar = {
    CALENDAR_ID: CALENDAR_ID,
    TIME_ZONE: TIME_ZONE,
    configured: CALENDAR_ID !== '' && API_KEY !== 'PASTE_API_KEY_HERE',
    fetchEvents: fetchEvents,
    descriptionFragment: descriptionFragment,
    toTeamTime: toTeamTime,
    parseDate: parseDate,
    startOfDay: startOfDay,
    addDays: addDays,
    addMonths: addMonths,
    sameDay: sameDay
  };
})();
