async function answerOf (request) {
  let answer
  try {
    answer = await request
  } catch (err) {
    return { error: `Oki does not answer — ${err.message}` }
  }
  return answer.json()
}

export const get = (route) => answerOf(fetch(`/oki/api/${route}`))

export const upload = (route, file, headers) => answerOf(fetch(`/oki/api/${route}`, {
  method: 'POST',
  headers: { 'content-type': 'application/octet-stream', ...headers },
  body: file
}))

export const post = (route, body) => answerOf(fetch(`/oki/api/${route}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
}))
