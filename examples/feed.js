const Express = require('express')
const Bodyparser = require('body-parser')
const app = Express()

app.use(Bodyparser.json())

app.get('/', function (req, res) {
  res.send({
    'version': 'https://jsonfeed.org/version/1',
    'title': 'My Example Feed',
    'home_page_url': 'https://example.org/',
    'feed_url': 'https://example.org/feed.json',
    'items': [
      {
        'id': '2',
        'content_text': 'This is a second item.',
        'url': 'https://example.org/second-item'
      },
      {
        'id': '1',
        'content_html': '<p>Hello, world!</p>',
        'url': 'https://example.org/initial-post'
      }
    ]
  })
})

app.listen(6000, () => console.log('Server listen on 127.0.0.1:6000'))
