Gem::Specification.new do |spec|
  spec.name = "jekyll-hover-popup"
  spec.version = File.read(File.expand_path("lib/jekyll/hover_popup/version.rb", __dir__))
    .match(/VERSION\s*=\s*"([^"]+)"/)[1]
  spec.authors = ["directsun"]
  spec.email = []

  spec.summary = "Jekyll plugin that shows in-page hover previews for internal documentation links."
  spec.homepage = "https://github.com/sunflowermans/hover-popup"
  spec.license = "MIT"

  spec.required_ruby_version = ">= 3.0"

  spec.files = Dir.glob("{lib,assets}/**/*") + %w[LICENSE README.md]
  spec.require_paths = ["lib"]

  spec.add_dependency "jekyll", ">= 3.7", "< 5.0"
end
