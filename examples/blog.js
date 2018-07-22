const fastify = require('fastify')

module.exports = async function(options) {
  const server = fastify(options)
  server.get('/feeds', function(req, res) {
    console.log('content provided')

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

  await server.listen(6000)
}

if (require.main === module) {
  module.exports().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
