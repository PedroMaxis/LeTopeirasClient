{
  "targets": [
    {
      "target_name": "audio_capture",
      "sources": ["src/addon.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX",
        "UNICODE",
        "_UNICODE"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": ["mmdevapi.lib", "ole32.lib", "avrt.lib"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": ["/std:c++20"],
                "ExceptionHandling": 1
              }
            }
          }
        ]
      ]
    }
  ]
}
