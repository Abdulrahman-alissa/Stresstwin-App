Pod::Spec.new do |s|
  s.name           = 'StressTwinKeyboard'
  s.version        = '1.0.0'
  s.summary        = 'Bridges the StressTwin Keyboard extension (behavioral typing stats only) to the app.'
  s.author         = 'StressTwin'
  s.homepage       = 'https://github.com/stresstwin/stresstwin'
  s.platforms      = { ios: '13.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'StressTwinKeyboard/**/*.{h,m,swift}', 'Shared/**/*.swift'
end
