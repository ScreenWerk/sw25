function toDateTimeString(ISODate) {
  return ISODate.slice(0, 10) + ' ' + ISODate.slice(11, 19)
}

async function fetchJSON(url) {
  const r = await fetch(url)
  try {
    if (r.status !== 200) {
      return false
    }
    return await r.json()
  } catch (e) {
    console.error(`Error fetching ${url}: ${e}`)
    return false
  }
}