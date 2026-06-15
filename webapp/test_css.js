const http = require('http');

http.get('http://localhost:3000/', (res) => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    const match = html.match(/href="(\/_next\/static\/css\/app\/layout\.css[^"]+)"/);
    if (!match) {
      console.log('No CSS match in HTML. HTML length:', html.length);
      process.exit(0);
    }
    const cssUrl = 'http://localhost:3000' + match[1];
    console.log('Found CSS URL:', cssUrl);
    http.get(cssUrl, (resCss) => {
      console.log('CSS Status:', resCss.statusCode);
      let css = '';
      resCss.on('data', chunk => css += chunk);
      resCss.on('end', () => {
        console.log('CSS length:', css.length);
        console.log('CSS snippet:', css.substring(0, 500));
      });
    });
  });
});
