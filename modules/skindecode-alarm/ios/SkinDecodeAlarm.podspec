require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'SkinDecodeAlarm'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'SkinDecode'
  s.homepage       = 'https://skindecode.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/expo/expo.git' }
  s.static_framework = true
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.resources      = ['skindecode_silent_alarm.caf']
  s.dependency 'ExpoModulesCore'
end
