import Foundation
// Runs the same link detection Shortcuts uses to turn text into URLs, on the old and new hash.
let site = "https://anks.pl/chce/add.html#"
let data: [String: Any] = [
  "url": "https://www.weareknitters.pl/products/osiris-snood-kit-yummy-version?_pos=23&_sid=acc3cd55b&_ss=r",
  "title": "Osiris Snood Kit - Yummy Version | We Are Knitters",
  "price": "289.00", "currency": "PLN",
  "images": [
    "https://www.weareknitters.pl/cdn/shop/files/osiris-1.jpg?v=1712&width=1200",
    "https://www.weareknitters.pl/cdn/shop/files/osiris-2.jpg?v=1712&width=1200",
    "https://www.weareknitters.pl/cdn/shop/files/osiris-3.jpg?v=1712",
  ],
]
let json = String(data: try! JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]), encoding: .utf8)!
var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-_.!~*'()")
let oldHash = json.addingPercentEncoding(withAllowedCharacters: allowed)!
let newHash = "b64=" + Data(json.utf8).base64EncodedString()
  .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
let det = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
for (name, hash) in [("OLD", oldHash), ("NEW", newHash)] {
  let text = site + hash
  let ms = det.matches(in: text, range: NSRange(text.startIndex..., in: text))
  print("== \(name): \(text.count) chars, \(ms.count) link(s)")
  for m in ms { print("  -> \(m.url!.absoluteString.prefix(160))") }
}
