
    (function () {
      var hash = String(location.hash || "");
      if (!hash.startsWith("#/")) return;
      var workMatch = hash.match(/^#\/work\/([^/?#]+)/);
      if (workMatch) {
        fetch("site-data.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (data) {
          var id = decodeURIComponent(workMatch[1]);
          var work = (data.works || []).find(function (item) { return item.id === id; });
          location.replace(work && work.slug ? "works/" + work.slug + ".html" : "index.html");
        }).catch(function () { location.replace("index.html"); });
        return;
      }
      var characterMatch = hash.match(/^#\/character\/([^/?#]+)/);
      if (characterMatch) {
        location.replace("category.html#c=" + encodeURIComponent(decodeURIComponent(characterMatch[1])));
        return;
      }
      location.replace("index.html");
    })();
