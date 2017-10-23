const fastify = require('fastify')()

fastify.get('/', function(req, res) {
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
  console.log(`server listening on ${fastify.server.address().port}`)
})
