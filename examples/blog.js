const fastify = require('fastify')({
  logger: {
    level: 'info'
  }
})

fastify.get('/feeds', function(req, res) {
  console.log('Content provided')

  res.send({
    version: 'https://jsonfeed.org/version/1',
    title: 'My Example Feed',
    home_page_url: 'https://example.org/',
    feed_url: 'https://example.org/feed.json',
    updated: '2003-12-13T18:30:02Z',
    items: [
      {
        id: '2',
        content_text: 'This is a second item.',
        url: 'https://example.org/second-item'
      },
      {
        id: '1',
        content_html: '<p>Hello, world!</p>',
        url: 'https://example.org/initial-post'
      }
    ]
  })
})

fastify.listen(6000, err => {
  if (err) throw err
})
